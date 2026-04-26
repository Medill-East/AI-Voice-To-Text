use std::ffi::c_void;
use std::io::{self, Write};
use std::mem::size_of;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
    RID_INPUT, RIDEV_INPUTSINK, RIM_TYPEKEYBOARD,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, TranslateMessage,
    CS_HREDRAW, CS_VREDRAW, HWND_MESSAGE, MSG, WNDCLASSW, WM_INPUT, WM_KEYDOWN, WM_KEYUP,
    WM_SYSKEYDOWN, WM_SYSKEYUP,
};

const RI_KEY_E0: u16 = 0x02;
const VK_SHIFT: u16 = 0x10;
const VK_CONTROL: u16 = 0x11;
const VK_MENU: u16 = 0x12;
const VK_LSHIFT: u16 = 0xA0;
const VK_RSHIFT: u16 = 0xA1;
const VK_LCONTROL: u16 = 0xA2;
const VK_RCONTROL: u16 = 0xA3;
const VK_LMENU: u16 = 0xA4;
const VK_RMENU: u16 = 0xA5;

fn main() {
    if let Err(error) = run() {
        eprintln!("raw-input-listener-error={error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    unsafe {
        let h_instance = GetModuleHandleW(null());
        if h_instance.is_null() {
            return Err("GetModuleHandleW failed".to_string());
        }

        let class_name = wide("V2TKeyboardListenerWindow");
        let window_class = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(window_proc),
            hInstance: h_instance,
            lpszClassName: class_name.as_ptr(),
            ..Default::default()
        };

        if RegisterClassW(&window_class) == 0 {
            return Err("RegisterClassW failed".to_string());
        }

        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            wide("V2T Keyboard Listener").as_ptr(),
            0,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            null_mut(),
            h_instance,
            null(),
        );
        if hwnd.is_null() {
            return Err("CreateWindowExW failed".to_string());
        }

        let device = RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: hwnd,
        };

        if RegisterRawInputDevices(&device, 1, size_of::<RAWINPUTDEVICE>() as u32) == 0 {
            return Err("RegisterRawInputDevices failed".to_string());
        }

        eprintln!("raw-input-ready");

        let mut message = MSG::default();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }

    Ok(())
}

unsafe extern "system" fn window_proc(hwnd: HWND, message: u32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if message == WM_INPUT {
        if let Err(error) = handle_raw_input(l_param as HRAWINPUT) {
            eprintln!("raw-input-event-error={error}");
        }
        return 0;
    }

    DefWindowProcW(hwnd, message, w_param, l_param)
}

unsafe fn handle_raw_input(raw_input: HRAWINPUT) -> Result<(), String> {
    let mut size = 0u32;
    let header_size = size_of::<RAWINPUTHEADER>() as u32;
    let probe = GetRawInputData(raw_input, RID_INPUT, null_mut(), &mut size, header_size);
    if probe == u32::MAX {
        return Err("GetRawInputData probe failed".to_string());
    }
    if size == 0 {
        return Ok(());
    }

    let mut buffer = vec![0u8; size as usize];
    let read = GetRawInputData(
        raw_input,
        RID_INPUT,
        buffer.as_mut_ptr() as *mut c_void,
        &mut size,
        header_size,
    );
    if read == u32::MAX {
        return Err("GetRawInputData read failed".to_string());
    }

    let raw = &*(buffer.as_ptr() as *const RAWINPUT);
    if raw.header.dwType != RIM_TYPEKEYBOARD {
        return Ok(());
    }

    let keyboard = raw.data.keyboard;
    let state = match keyboard.Message {
        WM_KEYDOWN | WM_SYSKEYDOWN => "DOWN",
        WM_KEYUP | WM_SYSKEYUP => "UP",
        _ => return Ok(()),
    };

    let v_key = normalize_side_specific_vkey(keyboard.VKey, keyboard.MakeCode, keyboard.Flags);

    println!(
        "{{\"type\":\"key\",\"state\":\"{}\",\"vKey\":{},\"scanCode\":{}}}",
        state, v_key, keyboard.MakeCode
    );
    io::stdout().flush().map_err(|error| error.to_string())
}

fn normalize_side_specific_vkey(v_key: u16, scan_code: u16, flags: u16) -> u16 {
    match v_key {
        VK_SHIFT => {
            if scan_code == 0x36 {
                VK_RSHIFT
            } else {
                VK_LSHIFT
            }
        }
        VK_CONTROL => {
            if flags & RI_KEY_E0 != 0 {
                VK_RCONTROL
            } else {
                VK_LCONTROL
            }
        }
        VK_MENU => {
            if flags & RI_KEY_E0 != 0 {
                VK_RMENU
            } else {
                VK_LMENU
            }
        }
        _ => v_key,
    }
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}
