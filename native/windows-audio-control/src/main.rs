use std::env;
use std::process::ExitCode;

use windows::core::{BOOL, GUID, Result};
use windows::Win32::Devices::FunctionDiscovery::*;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

fn main() -> ExitCode {
    match run() {
        Ok(output) => {
            if let Some(output) = output {
                println!("{output}");
            }
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("audio-control-error={error}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<Option<String>> {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let command = args.first().map(String::as_str).unwrap_or("read");
    let _com = ComGuard::new()?;
    let endpoint = default_render_endpoint()?;

    match command {
        "read" => {
            let muted = unsafe { endpoint.GetMute()?.as_bool() };
            let volume = unsafe { endpoint.GetMasterVolumeLevelScalar()? };
            Ok(Some(format!(
                "{{\"muted\":{},\"volume\":{}}}",
                if muted { "true" } else { "false" },
                clamp_volume(volume)
            )))
        }
        "mute" => {
            unsafe {
                endpoint.SetMute(win_bool(true), &GUID::zeroed())?;
            }
            Ok(None)
        }
        "restore" => {
            let volume = parse_flag_value(&args, "--volume")
                .and_then(|value| value.parse::<f32>().ok())
                .unwrap_or(1.0);
            let muted = parse_flag_value(&args, "--muted").map(|value| value == "true").unwrap_or(false);
            unsafe {
                endpoint.SetMasterVolumeLevelScalar(clamp_volume(volume), &GUID::zeroed())?;
                endpoint.SetMute(win_bool(muted), &GUID::zeroed())?;
            }
            Ok(None)
        }
        _ => Err(windows::core::Error::new(
            windows::core::HRESULT(0x80070057u32 as i32),
            format!("unknown command: {command}")
        )),
    }
}

fn default_render_endpoint() -> Result<IAudioEndpointVolume> {
    unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        device.Activate(CLSCTX_ALL, None)
    }
}

fn parse_flag_value<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.windows(2).find_map(|pair| (pair[0] == name).then_some(pair[1].as_str()))
}

fn clamp_volume(volume: f32) -> f32 {
    if volume.is_finite() {
        volume.clamp(0.0, 1.0)
    } else {
        1.0
    }
}

fn win_bool(value: bool) -> BOOL {
    if value {
        BOOL(1)
    } else {
        BOOL(0)
    }
}

struct ComGuard;

impl ComGuard {
    fn new() -> Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        }
        Ok(Self)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
