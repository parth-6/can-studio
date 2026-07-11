# Implementation Plan: gs_usb (CANnectivity) Adapter Support

## Overview
Add support for CANnectivity hardware using the gs_usb (Geschwister Schneider USB/CAN) protocol. This is a **binary USB-based USB-based protocol uses bulk endpoints and control requests, completely different from the ASCII-based SLCAN protocol.

## Technical Analysis

### Protocol Differences
| Aspect | SLCAN (Current) | gs_usb (CANnectivity) |
|--------|-----------------|----------------------|
| Transport | Serial/COM (SerialPort) | USB Bulk Endpoints (libusb/WinUSB) |
| Frame Format | ASCII strings (`t1238DEADBEEF\r`) | Binary frames over USB bulk |
| Configuration | ASCII commands (`S6`, `O`, `C`) | USB Control Requests (vendor-specific) |
| Driver | SerialPort (COM port) | libusb/WinUSB (USB bulk endpoints) |
| CAN FD Support | Not implemented | Native support |

### CANnectivity Hardware Details
- **VID/PID**: 0x1209 / 0x0001 (or similar, need to verify)
- **Interface**: USB CDC-ACM + gs_usb vendor interface
- **Endpoints**: Bulk IN (0x81), Bulk OUT1 (0x01), Bulk OUT2 (0x02)
- **Protocol**: gs_usb (Geschwister Schneider USB/CAN)
- **Features**: CAN Classic, CAN FD, Hardware Timestamping, Multiple Channels

## Implementation Plan

### Phase 1: Foundation & Research (Week 1)
- [ ] **T001** Research gs_usb protocol specification from CANnectivity repo
- [ ] **T002** Identify exact VID/PID for CANnectivity devices
- [ ] **T003** Choose USB library: `@serialport/usb` vs `usb` vs `node-usb` vs `@node-usb/usb`
- [ ] **T004** Create `GsUsbCanAdapter.ts` implementing `ICanBusAdapter`
- [ ] **T005** Register in `AdapterFactory` as `AdapterType.GsUsb`

### Phase 2: Core USB Communication (Week 1-2)
- [ ] **T006** Implement USB device discovery (VID/PID matching)
- [ ] **T007** Implement USB interface claim & endpoint configuration
- [ ] **T008** Implement bulk IN endpoint reading (async stream)
- [ ] **T009** Implement bulk OUT endpoint writing
- [ ] **T010** Implement USB control requests for configuration:
  - `GS_USB_REQUEST_HOST_FORMAT` (endianness)
  - `GS_USB_REQUEST_BITTIMING` (classic CAN)
  - `GS_USB_REQUEST_DATA_BITTIMING` (CAN FD data phase)
  - `GS_USB_REQUEST_MODE` (start/stop channel)
  - `GS_USB_REQUEST_BT_CONST` / `BT_CONST_EXT` (timing limits)
  - `GS_USB_REQUEST_SET_TERMINATION` / `GET_TERMINATION`
  - `GS_USB_REQUEST_GET_STATE`

### Phase 3: Frame Encoding/Decoding (Week 2)
- [ ] **T011** Implement gs_usb binary frame parsing (host frame header + payload)
- [ ] **T012** Implement gs_usb frame building for transmission
- [ ] **T013** Handle CAN FD frames (64-byte payload, BRS/ESI flags)
- [ ] **T014** Handle hardware timestamping (if enabled)
- [ ] **T015** Handle multi-channel support (channel field in frame header)

### Phase 4: Integration & UI (Week 2-3)
- [ ] **T016** Update `ConnectBusCommand` for gs_usb device selection
- [ ] **T017** Add device enumeration (list available CANnectivity devices)
- [ ] **T018** Add channel selection for multi-channel devices
- [ ] **T019** Update `WebviewMessageHandler` for gs_usb adapter type
- [ ] **T020** Register in `extension.ts` during activation

### Phase 5: Testing & Polish (Week 3)
- [ ] **T021** Unit tests for frame encoding/decoding
- [ ] **T022** Integration test with actual CANnectivity hardware
- [ ] **T022** Test CAN FD functionality
- [ ] **T023** Test multi-channel support
- [ ] **T024** Test hardware timestamping
- [ ] **T025** Documentation & README updates

## Technical Details

### gs_usb Frame Structure (from CANnectivity headers)
```c
// Host frame header (prepended to each frame on bulk endpoints)
struct gs_usb_host_frame_hdr {
    uint32_t echo_id;      // Echo ID for TX confirmation
    uint32_t can_id;       // CAN ID (with flags)
    uint8_t  can_dlc;      // DLC (0-15 for FD)
    uint8_t  channel;      // Channel index
    uint8_t  flags;        // GS_USB_CAN_FLAG_*
    uint8_t  reserved;
};

// Frame payload follows header (up to 64 bytes for FD)
```

### Key USB Control Requests
| Request | Code | Direction | Purpose |
|---------|------|-----------|---------|
| GS_USB_REQUEST_HOST_FORMAT | 0 | OUT | Set host byte order |
| GS_USB_REQUEST_BITTIMING | 1 | OUT | Set classic CAN bit timing |
| GS_USB_REQUEST_DATA_BITTIMING | 10 | OUT | Set CAN FD data phase timing |
| GS_USB_REQUEST_MODE | 2 | OUT | Start/stop channel |
| GS_USB_REQUEST_BT_CONST | 3 | IN | Get classic timing limits |
| GS_USB_REQUEST_BT_CONST_EXT | 11 | IN | Get FD timing limits |
| GS_USB_REQUEST_SET_TERMINATION | 12 | OUT | Enable/disable termination |
| GS_USB_REQUEST_GET_TERMINATION | 13 | IN | Get termination state |
| GS_USB_REQUEST_GET_STATE | 14 | IN | Get bus state/error counters |

### CAN ID Flags (from gs_usb.h)
```c
#define GS_USB_CAN_FLAG_FD       BIT(1)  // CAN FD frame
#define GS_USB_CAN_FLAG_BRS      BIT(2)  // Bit Rate Switch
#define GS_USB_CAN_FLAG_ESI      BIT(3)  // Error State Indicator
```

## Dependencies
- **USB Library**: Need to choose one:
  - `@serialport/usb` - SerialPort's USB backend (consistent with existing serialport dep)
  - `usb` - node-usb (libusb bindings, mature)
  - `@node-usb/usb` - Modern fork of node-usb
  - `webusb` - WebUSB API (browser only, not for Node)

**Recommendation**: `@serialport/usb` since we already depend on `serialport` and it provides a consistent API.

## File Structure
```
src/infrastructure/adapters/
├── GsUsbCanAdapter.ts          # New adapter implementation
├── GsUsbFrame.ts               # Frame encoding/decoding
├── GsUsbControlRequests.ts     # USB control request helpers
├── GsUsbConstants.ts           # Protocol constants
├── AdapterFactory.ts           # Register GsUsb type
└── index.ts                    # Export new adapter
```

## Acceptance Criteria
- [ ] Extension detects CANnectivity device on USB connect
- [ ] User can select device from "Connect to CAN Bus" command
- [ ] Classic CAN 2.0 frames transmit/receive correctly
- [ ] CAN FD frames (up to 64 bytes) transmit/receive correctly
- [ ] Hardware timestamping works (if device supports)
- [ ] Multi-channel devices show all channels
- [ ] Bus termination control works
- [ ] Bus state/error reporting works
- [ ] No regression in existing SLCAN/Virtual adapters