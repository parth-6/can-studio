/**
 * gs_usb protocol constants and type definitions
 * Based on CANnectivity firmware: include/cannectivity/usb/class/gs_usb.h
 */

/** USB Vendor/Product IDs for CANnectivity devices */
export const GS_USB_VID = 0x1209;  // pid.codes VID
export const GS_USB_PID = 0x0001;  // CANnectivity PID (verify with actual device)

/** USB Endpoint Addresses */
export const GS_USB_IN_EP_ADDR = 0x81;      // Bulk IN endpoint
export const GS_USB_OUT1_EP_ADDR = 0x01;    // Bulk OUT1 endpoint
export const GS_USB_OUT2_EP_ADDR = 0x02;    // Bulk OUT2 endpoint

/** gs_usb bRequest codes (vendor-specific control requests) */
export enum GsUsbRequest {
    HOST_FORMAT = 0,           // Set host byte order
    BITTIMING = 1,             // Set classic CAN bit timing
    MODE = 2,                  // Start/stop channel
    BT_CONST = 3,              // Get classic timing limits
    DEVICE_CONFIG = 4,         // Get device config
    TIMESTAMP = 5,             // Get hardware timestamp
    IDENTIFY = 6,              // Visual identification
    GET_USER_ID = 7,           // Get user ID (unsupported)
    SET_USER_ID = 8,           // Set user ID (unsupported)
    DATA_BITTIMING = 10,       // Set CAN FD data phase bit timing
    BT_CONST_EXT = 11,         // Get FD timing limits
    SET_TERMINATION = 12,      // Set bus termination
    GET_TERMINATION = 13,      // Get termination state
    GET_STATE = 14,            // Get bus state/error counters
}

/** Host format byte order identifiers */
export const GS_USB_HOST_FORMAT_LITTLE_ENDIAN = 0x00000000;
export const GS_USB_HOST_FORMAT_BIG_ENDIAN = 0x01000000;

/** Channel modes */
export enum GsUsbChannelMode {
    RESET = 0,
    START = 1,
}

/** Channel states */
export enum GsUsbChannelState {
    ERROR_ACTIVE = 0,
    ERROR_WARNING = 1,
    ERROR_PASSIVE = 2,
    BUS_OFF = 3,
    STOPPED = 4,
    SLEEPING = 5,
}

/** CAN frame flags */
export const GS_USB_CAN_FLAG_FD = 0x02;      // BIT(1) - CAN FD frame
export const GS_USB_CAN_FLAG_BRS = 0x04;     // BIT(2) - Bit Rate Switch
export const GS_USB_CAN_FLAG_ESI = 0x08;     // BIT(3) - Error State Indicator

/** CAN ID flags (matching Linux can.h) */
export const GS_USB_CAN_ID_FLAG_ERR_CRTL = 0x00000004;   // BIT(2)
export const GS_USB_CAN_ID_FLAG_ERR_BUSOFF = 0x00000040; // BIT(6)
export const GS_USB_CAN_ID_FLAG_ERR_RESTARTED = 0x00000100; // BIT(8)
export const GS_USB_CAN_ID_FLAG_ERR_CNT = 0x00000200;    // BIT(9)

/** Host frame header size (bytes) */
export const GS_USB_HOST_FRAME_HDR_SIZE = 16;

/** Maximum CAN FD payload size */
export const GS_USB_MAX_DATA_LEN = 64;

/** USB bulk endpoint max packet size */
export const GS_USB_BULK_MAX_PACKET_SIZE = 64;

/** Device config structure size */
export const GS_USB_DEVICE_CONFIG_SIZE = 64;

/** Host frame header structure (packed, little-endian) */
export interface GsUsbHostFrameHeader {
    echoId: number;      // uint32_t
    canId: number;       // uint32_t (with flags)
    canDlc: number;      // uint8_t
    channel: number;     // uint8_t
    flags: number;       // uint8_t
    reserved: number;    // uint8_t
}

/** Device configuration (from GS_USB_REQUEST_DEVICE_CONFIG) */
export interface GsUsbDeviceConfig {
    reserved1: number;
    reserved2: number;
    reserved3: number;
    nchannels: number;       // Number of channels - 1
    swVersion: number;       // Software version
    hwVersion: number;       // Hardware version
}

/** Bit timing constants (classic CAN) */
export interface GsUsbBtConst {
    feature: number;         // GsUsbCanChannelFeature flags
    fclkCan: number;         // CAN core clock frequency (Hz)
    tseg1Min: number;
    tseg1Max: number;
    tseg2Min: number;
    tseg2Max: number;
    sjwMax: number;
    brpMin: number;
    brpMax: number;
    brpInc: number;
}

/** Bit timing constants extended (CAN FD) */
export interface GsUsbBtConstExt {
    feature: number;
    fclkCan: number;
    tseg1Min: number;
    tseg1Max: number;
    tseg2Min: number;
    tseg2Max: number;
    sjwMax: number;
    brpMin: number;
    brpMax: number;
    brpInc: number;
    dtseg1Min: number;
    dtseg1Max: number;
    dtseg2Min: number;
    dtseg2Max: number;
    dsjwMax: number;
    dbrpMin: number;
    dbrpMax: number;
    dbrpInc: number;
}

/** Bit timing configuration */
export interface GsUsbBittiming {
    propSeg: number;
    phaseSeg1: number;
    phaseSeg2: number;
    sjw: number;
    brp: number;
}

/** Channel mode configuration */
export interface GsUsbDeviceMode {
    mode: GsUsbChannelMode;
    flags: number;  // GsUsbCanChannelFlag bits
}

/** Channel state */
export interface GsUsbDeviceState {
    state: GsUsbChannelState;
    rxerr: number;
    txerr: number;
}

/** Termination state */
export interface GsUsbTerminationState {
    state: number;  // 0 = off, 1 = on
}

/** Channel features */
export const GS_USB_CAN_FEATURE_LISTEN_ONLY = 0x01;
export const GS_USB_CAN_FEATURE_LOOP_BACK = 0x02;
export const GS_USB_CAN_FEATURE_TRIPLE_SAMPLE = 0x04;
export const GS_USB_CAN_FEATURE_ONE_SHOT = 0x08;
export const GS_USB_CAN_FEATURE_HW_TIMESTAMP = 0x10;
export const GS_USB_CAN_FEATURE_IDENTIFY = 0x20;
export const GS_USB_CAN_FEATURE_USER_ID = 0x40;
export const GS_USB_CAN_FEATURE_PAD_PKTS = 0x80;
export const GS_USB_CAN_FEATURE_FD = 0x100;

/** Host frame flags */
export const GS_USB_HOST_FRAME_FLAG_PAD = 0x80;  // Pad packets to max size

/** Alias constants for backward compatibility with GsUsbCanAdapter imports */
export const GS_USB_REQUEST_HOST_FORMAT = GsUsbRequest.HOST_FORMAT;
export const GS_USB_REQUEST_BITTIMING = GsUsbRequest.BITTIMING;
export const GS_USB_REQUEST_DATA_BITTIMING = GsUsbRequest.DATA_BITTIMING;
export const GS_USB_REQUEST_MODE = GsUsbRequest.MODE;
export const GS_USB_REQUEST_BT_CONST = GsUsbRequest.BT_CONST;
export const GS_USB_REQUEST_BT_CONST_EXT = GsUsbRequest.BT_CONST_EXT;
export const GS_USB_REQUEST_SET_TERMINATION = GsUsbRequest.SET_TERMINATION;
export const GS_USB_REQUEST_GET_TERMINATION = GsUsbRequest.GET_TERMINATION;
export const GS_USB_REQUEST_GET_STATE = GsUsbRequest.GET_STATE;
export const GS_USB_REQUEST_DEVICE_CONFIG = GsUsbRequest.DEVICE_CONFIG;

export const GS_USB_CHANNEL_MODE_START = GsUsbChannelMode.START;
export const GS_USB_CHANNEL_MODE_RESET = GsUsbChannelMode.RESET;