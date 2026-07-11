// Type declarations for the `usb` package to match the actual runtime API
// The @types/usb package is incomplete/outdated

declare module 'usb' {
    interface Device {
        deviceDescriptor: {
            idVendor: number;
            idProduct: number;
            bcdDevice: number;
            iManufacturer: number;
            iProduct: number;
            iSerialNumber: number;
        };
        open(): Promise<void>;
        close(): Promise<void>;
        reset(): Promise<void>;
        setConfiguration(configuration: number): Promise<void>;
        claimInterface(interfaceNumber: number): Promise<void>;
        releaseInterface(interfaceNumber: number): Promise<void>;
        controlTransfer(
            setup: {
                bmRequestType: number;
                bRequest: number;
                wValue: number;
                wIndex: number;
            },
            data: Buffer,
            callback: (error: Error | null) => void
        ): void;
        controlTransfer(
            setup: {
                bmRequestType: number;
                bRequest: number;
                wValue: number;
                wIndex: number;
            },
            length: number,
            callback: (error: Error | null, data: Buffer) => void
        ): void;
        transferIn(endpoint: number, length: number, callback: (error: Error | null, data: Buffer) => void): void;
        transferOut(endpoint: number, data: Buffer, callback: (error: Error | null) => void): void;
        releaseInterface(interfaceNumber: number): Promise<void>;
        close(): Promise<void>;
    }

    function getDeviceList(): Device[];
    function findByIds(vid: number, pid: number): Device | undefined;

    const USB: {
        getDeviceList: () => Device[];
        findByIds: (vid: number, pid: number) => Device | undefined;
    };

    export = USB;
    export { USB, getDeviceList, findByIds };
}