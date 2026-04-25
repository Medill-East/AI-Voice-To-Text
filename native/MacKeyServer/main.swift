import Carbon
import CoreGraphics
import Foundation

private let eventMask =
  (1 << CGEventType.keyDown.rawValue) |
  (1 << CGEventType.keyUp.rawValue) |
  (1 << CGEventType.flagsChanged.rawValue)

private var eventId: UInt64 = 1
private var modifierState: [Int64: Bool] = [:]
private let lock = NSLock()

FileHandle.standardInput.readabilityHandler = { handle in
  _ = handle.availableData
}

func nextEventId() -> UInt64 {
  lock.lock()
  defer { lock.unlock() }
  let current = eventId
  eventId += 1
  return current
}

func output(_ state: String, keyCode: Int64) {
  let line = "KEYBOARD,\(state),\(keyCode),0,0,\(nextEventId())\n"
  if let data = line.data(using: .utf8) {
    FileHandle.standardOutput.write(data)
  }
}

func modifierStateFor(keyCode: Int64) -> String {
  lock.lock()
  defer { lock.unlock() }
  let isDown = !(modifierState[keyCode] ?? false)
  modifierState[keyCode] = isDown
  return isDown ? "DOWN" : "UP"
}

let callback: CGEventTapCallBack = { _, type, event, _ in
  let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
  switch type {
  case .keyDown:
    output("DOWN", keyCode: keyCode)
  case .keyUp:
    output("UP", keyCode: keyCode)
  case .flagsChanged:
    output(modifierStateFor(keyCode: keyCode), keyCode: keyCode)
  default:
    break
  }
  return Unmanaged.passUnretained(event)
}

guard let eventTap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .defaultTap,
  eventsOfInterest: CGEventMask(eventMask),
  callback: callback,
  userInfo: nil
) else {
  fputs("Unable to create CGEvent tap. Grant Accessibility permission to V2T Keyboard Listener.\n", stderr)
  exit(2)
}

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
CFRunLoopRun()
