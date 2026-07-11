import * as assert from 'assert';
import { AdapterType } from '../../../../src/core/enums/AdapterType';
import { AdapterFactory } from '../../../../src/infrastructure/adapters/AdapterFactory';
import { SLCANCanAdapter } from '../../../../src/infrastructure/adapters/SLCANCanAdapter';

suite('SLCANCanAdapter', () => {
    test('SLCAN adapter is registered in AdapterFactory', () => {
        const supportedTypes = AdapterFactory.getSupportedTypes();
        assert.ok(supportedTypes.includes(AdapterType.SLCAN), 'SLCAN should be in supported types');
    });

    test('AdapterFactory.create returns SLCANCanAdapter instance', () => {
        const adapter = AdapterFactory.create(AdapterType.SLCAN);
        assert.ok(adapter instanceof SLCANCanAdapter, 'Should create SLCANCanAdapter instance');
    });

    test('SLCANCanAdapter initial state is Disconnected', () => {
        const adapter = new SLCANCanAdapter();
        assert.strictEqual(adapter.state, 'disconnected');
    });

    test('SLCANCanAdapter implements ICanBusAdapter interface', () => {
        const adapter = new SLCANCanAdapter();
        assert.ok(typeof adapter.connect === 'function');
        assert.ok(typeof adapter.disconnect === 'function');
        assert.ok(typeof adapter.send === 'function');
        assert.ok(typeof adapter.onFrameReceived === 'function');
        assert.ok(typeof adapter.onStateChanged === 'function');
        assert.ok(typeof adapter.onError === 'function');
    });
});