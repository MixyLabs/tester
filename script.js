const MIDI_SERVICE_UUIDS = [
    '03b80e5a-ede8-4b33-a751-6ce34ec4c700',
    '03b80e5a-ede8-4b33-a751-6ce34ec4c705'
];

document.addEventListener('alpine:init', () => {
    Alpine.data('midiTester', () => ({
        connected: false,
        device: {},
        controls: [
            { name: 'CC 1', value: -1 },
            { name: 'CC 2', value: -1 },
            { name: 'CC 3', value: -1 },
            { name: 'CC 4', value: -1 },
            { name: 'CC 5', value: -1 },
        ],
        mixyParams: [
            {
                key: 'ChangeThreshold',
                label: 'Change Threshold',
                value: -1,
                min: 1,
                max: 99,
                step: 1
            },
            {
                key: 'SlowInterval',
                label: 'Slow Interval',
                value: -1,
                min: 300,
                max: 900,
                step: 25
            },
            {
                key: 'FastInterval',
                label: 'Fast Interval',
                value: -1,
                min: 40,
                max: 150,
                step: 5
            },
            {
                key: 'FastTimeout',
                label: 'Fast Timeout',
                value: -1,
                min: 50,
                max: 600,
                step: 50
            }
        ],
        server: null,
        midiCharacteristic: null,
        lastSentParams: [10, 300, 90, 200], // Default values
        init() {
            this.mixyParams.forEach((param, i) => {
                param.value = this.lastSentParams[i];
            });
        },
        paramsChanged() {
            return this.mixyParams.some((p, i) => p.value !== this.lastSentParams[i]);
        },
        async connect() {
            try {
                const bleDevice = await navigator.bluetooth.requestDevice({
                    filters: [{ // real MIDI service is always advertised
                        services: ['03b80e5a-ede8-4b33-a751-6ce34ec4c700']
                    }],  // make fake one optional to be able to use it
                    optionalServices: ['03b80e5a-ede8-4b33-a751-6ce34ec4c705']
                });

                this.server = await bleDevice.gatt.connect();
                let service = null;
                for (const uuid of MIDI_SERVICE_UUIDS) {
                    try {
                        service = await this.server.getPrimaryService(uuid);
                        break;
                    } catch (e) {
                        // Try next one
                    }
                }
                if (!service) {
                    throw new Error('Neither MIDI service UUID found on device.');
                }
                this.midiCharacteristic = await service.getCharacteristic('7772e5db-3868-4112-a1a9-f2669d106bf3');

                this.midiCharacteristic.addEventListener('characteristicvaluechanged', this.handleMidiMessage.bind(this));
                await this.midiCharacteristic.startNotifications();

                // Initiate MIDI message flow
                this.midiCharacteristic.readValue();

                // Add event listener for gattserverdisconnected
                bleDevice.addEventListener('gattserverdisconnected', (event) => {
                    console.warn('BLE device disconnected:', event);
                    this.disconnect();
                });

                this.device = {
                    model: "Mixy Beta TODO",
                    serialNumber: 'TODO',
                    knobsAmount: 5, // TODO
                };
                this.connected = true;

            } catch (error) {
                console.error('Could not connect to BLE MIDI device.', error);
            }
        },

        disconnect() {
            if (this.server && this.server.connected) {
                this.server.disconnect();
            }
            this.connected = false;
            this.device = {};
            this.server = null;
            this.midiCharacteristic = null;

            this.controls.forEach((control) => {
                control.value = -1;
            });
        },

        handleMidiMessage(event) {
            const packet = event.target.value;
            let i = 0;

            // Skip header
            if (i >= packet.byteLength || (packet.getUint8(i) & 0x80) === 0) {
                return; // invalid packet
            }
            i++;

            while (i < packet.byteLength) {
                const b = packet.getUint8(i);

                // Skip any non-timestamp bytes
                if ((b & 0x80) === 0) {
                    i++;
                    continue;
                }

                // Timestamp byte
                i++;
                if (i + 2 >= packet.byteLength) {
                    break; // incomplete message
                }

                const status = packet.getUint8(i);
                const ctrl = packet.getUint8(i + 1);
                const val = packet.getUint8(i + 2);
                i += 3;

                // Only parse CC messages
                if ((status & 0xF0) === 0xB0) {
                    const controlIndex = this.controls.findIndex(c => c.name === `CC ${ctrl}`);
                    if (controlIndex !== -1) {
                        this.controls[controlIndex].value = Math.round((val / 127) * 100);
                    }
                }
            }
        },

        onParamWheel(event, param) {
            event.preventDefault();
            const delta = event.deltaY < 0 ? param.step : -param.step;
            let newValue = param.value + delta;
            if (newValue < param.min) newValue = param.min;
            if (newValue > param.max) newValue = param.max;
            param.value = newValue;
        },

        applyMixyParams() {
            // Validate and clamp values
            this.mixyParams.forEach(param => {
                if (param.value < param.min) param.value = param.min;
                if (param.value > param.max) param.value = param.max;
            });

            // Marshalling
            const buffer = new ArrayBuffer(8);
            const view = new DataView(buffer);
            view.setUint16(0, this.mixyParams[0].value, true); // ChangeThreshold
            view.setUint16(2, this.mixyParams[1].value, true); // SlowInterval
            view.setUint16(4, this.mixyParams[2].value, true); // FastInterval
            view.setUint16(6, this.mixyParams[3].value, true); // FastTimeout

            // Send via BLE
            if (this.midiCharacteristic && this.connected) {
                this.midiCharacteristic.writeValueWithoutResponse(buffer).then(() => {
                    // Update last sent params
                    this.lastSentParams = this.mixyParams.map(p => p.value);
                }).catch(e => {
                    console.error('Failed to send MixyParams', e);
                });
            } else {
                // Update last sent params even if not connected (for UI)
                this.lastSentParams = this.mixyParams.map(p => p.value);
            }
            console.log('Sent MixyParams:', this.mixyParams.map(p => `${p.key}=${p.value}`).join(', '));
        },
        paramsChanged() {
            return this.mixyParams.some((p, i) => p.value !== this.lastSentParams[i]);
        },
    }));
});
