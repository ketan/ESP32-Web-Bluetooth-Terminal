/**
 * Bluetooth Terminal class.
 */
class BluetoothTerminal {
  /**
   * Create preconfigured Bluetooth Terminal instance.
   * @param {!(number|string)} [serviceUuid=0xFFE0] - Service UUID
   * @param {!(number|string)} [characteristicUuid=0xFFE1] - Characteristic UUID
   * @param {string} [receiveSeparator='\n'] - Receive separator
   * @param {string} [sendSeparator='\n'] - Send separator
   */
  constructor(serviceUuid = "6e400001-b5a3-f393-e0a9-e50e24dcca9e", characteristicUuidTx = "6e400003-b5a3-f393-e0a9-e50e24dcca9e", characteristicUuidRx = "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
      receiveSeparator = '\n', sendSeparator = '\n') {
    // Used private variables.
    this._receiveBuffer = ''; // Buffer containing not separated data.
    this._maxCharacteristicValueLength = 60; // Max characteristic value length.
    this._device = null; // Device object cache.
    this._service = null;
    this._characteristicTx = null; // Characteristic object cache.
    this._characteristicRx = null; // Characteristic object cache.

    // Bound functions used to add and remove appropriate event handlers.
    this._boundHandleDisconnection = this._handleDisconnection.bind(this);
    this._boundHandleCharacteristicValueChanged =
        this._handleCharacteristicValueChanged.bind(this);

    // Configure with specified parameters.
    this.setServiceUuid(serviceUuid);
    this.setCharacteristicUuidTx(characteristicUuidTx);
    this.setCharacteristicUuidRx(characteristicUuidRx);
    this.setReceiveSeparator(receiveSeparator);
    this.setSendSeparator(sendSeparator);
  }

  /**
   * Set number or string representing service UUID used.
   * @param {!(number|string)} uuid - Service UUID
   */
  setServiceUuid(uuid) {
    if (!Number.isInteger(uuid) &&
        !(typeof uuid === 'string' || uuid instanceof String)) {
      throw new Error('UUID type is neither a number nor a string');
    }

    if (!uuid) {
      throw new Error('UUID cannot be a null');
    }

    this._serviceUuid = uuid;
  }

  /**
   * Set number or string representing characteristic UUID used.
   * @param {!(number|string)} uuid - Characteristic UUID
   */
  setCharacteristicUuidTx(uuid) {
    if (!Number.isInteger(uuid) &&
        !(typeof uuid === 'string' || uuid instanceof String)) {
      throw new Error('UUID type is neither a number nor a string');
    }

    if (!uuid) {
      throw new Error('UUID cannot be a null');
    }

    this._characteristicUuidTx = uuid;
  }

  setCharacteristicUuidRx(uuid) {
    if (!Number.isInteger(uuid) &&
        !(typeof uuid === 'string' || uuid instanceof String)) {
      throw new Error('UUID type is neither a number nor a string');
    }

    if (!uuid) {
      throw new Error('UUID cannot be a null');
    }

    this._characteristicUuidRx = uuid;
  }

  /**
   * Set character representing separator for data coming from the connected
   * device, end of line for example.
   * @param {string} separator - Receive separator with length equal to one
   *                             character
   */
  setReceiveSeparator(separator) {
    if (!(typeof separator === 'string' || separator instanceof String)) {
      throw new Error('Separator type is not a string');
    }

    if (separator.length !== 1) {
      throw new Error('Separator length must be equal to one character');
    }

    this._receiveSeparator = separator;
  }

  /**
   * Set string representing separator for data coming to the connected
   * device, end of line for example.
   * @param {string} separator - Send separator
   */
  setSendSeparator(separator) {
    if (!(typeof separator === 'string' || separator instanceof String)) {
      throw new Error('Separator type is not a string');
    }

    if (separator.length !== 1) {
      throw new Error('Separator length must be equal to one character');
    }

    this._sendSeparator = separator;
  }

  /**
   * Launch Bluetooth device chooser and connect to the selected device.
   * @return {Promise} Promise which will be fulfilled when notifications will
   *                   be started or rejected if something went wrong
   */
  connect() {
    return this._connectToDevice(this._device);
  }

  /**
   * Disconnect from the connected device.
   */
  disconnect() {
    this._disconnectFromDevice(this._device);

    if (this._characteristicTx) {
      this._characteristicTx.removeEventListener('characteristicvaluechanged',
          this._boundHandleCharacteristicValueChanged);
      this._characteristicTx = null;
    }

    this._device = null;
  }

  /**
   * Data receiving handler which called whenever the new data comes from
   * the connected device, override it to handle incoming data.
   * @param {string} data - Data
   */
  receive(data) {
    // Handle incoming data.
  }

  /**
   * Send data to the connected device.
   * @param {string} data - Data
   * @return {Promise} Promise which will be fulfilled when data will be sent or
   *                   rejected if something went wrong
   */
  send(data) {


    // Convert data to the string using global object.
    data = String(data || '');

    // Return rejected promise immediately if data is empty.
    if (!data) {
      return Promise.reject(new Error('Data must be not empty'));
    }

    data += this._sendSeparator;

    // Split data to chunks by max characteristic value length.
    const chunks = this.constructor._splitByLength(data,
        this._maxCharacteristicValueLength);

    // Return rejected promise immediately if there is no connected device.
    if (!this._characteristicRx) {
      return Promise.reject(new Error('There is no connected device'));
    }

    // Write first chunk to the characteristic immediately.
    let promise = this._writeToCharacteristic(this._characteristicRx, chunks[0]);

    // Iterate over chunks if there are more than one of it.

    for (let i = 1; i < chunks.length; i++) {
      // Chain new promise.
      promise = promise.then(() => new Promise((resolve, reject) => {
        // Reject promise if the device has been disconnected.
        if (!this._characteristicTx) {
          reject(new Error('Device has been disconnected'));
        }

        // Write chunk to the characteristic and resolve the promise.
        this._writeToCharacteristic(this._characteristicRx, chunks[i]).
            then(resolve).
            catch(reject);
      }));
    }

    return promise;
  }

  /**
   * Get the connected device name.
   * @return {string} Device name or empty string if not connected
   */
  getDeviceName() {
    if (!this._device) {
      return '';
    }

    return this._device.name;
  }

  /**
   * Connect to device.
   * @param {Object} device
   * @return {Promise}
   * @private
   */
  _connectToDevice(device) {
    return (device ? Promise.resolve(device) : this._requestBluetoothDevice()).
        then((device) => this._connectDeviceAndCacheCharacteristic(device)).
        then((characteristics) => this._startNotifications(characteristics[0])).
        catch((error) => {
          this._log(error);
          return Promise.reject(error);
        });
  }

  /**
   * Disconnect from device.
   * @param {Object} device
   * @private
   */
  _disconnectFromDevice(device) {
    if (!device) {
      return;
    }

    this._log('Disconnecting from "' + device.name + '" bluetooth device...');

    device.removeEventListener('gattserverdisconnected',
        this._boundHandleDisconnection);

    if (!device.gatt.connected) {
      this._log('"' + device.name +
          '" bluetooth device is already disconnected');
      return;
    }

    device.gatt.disconnect();

    this._log('"' + device.name + '" bluetooth device disconnected');
  }

  /**
   * Request bluetooth device.
   * @return {Promise}
   * @private
   */
  _requestBluetoothDevice() {

    this._log('Requesting bluetooth device... with service1 ' + this._serviceUuid);

    return navigator.bluetooth.requestDevice({
      filters: [{services: [this._serviceUuid]}],
    }).



	//services: ['c48e6067-5295-48d3-8d5c-0395f61792b1']
        then((device) => {
          this._log('"' + device.name + '" bluetooth device selected');

          this._device = device; // Remember device.
          this._device.addEventListener('gattserverdisconnected',
              this._boundHandleDisconnection);

          return this._device;
        });
  }

  /**
   * Connect device and cache characteristic.
   * @param {Object} device
   * @return {Promise}
   * @private
   */
  _connectDeviceAndCacheCharacteristic(device) {
    // Check remembered characteristic.
    if (device.gatt.connected && this._characteristicTx && this._characteristicRx) {
      return Promise.resolve([this._characteristicTx, this._characteristicRx]);
    }

    this._log('Connecting to GATT server...');

    return device.gatt.connect().
        then((server) => {
          this._log('GATT server connected', 'Getting service...');

          return server.getPrimaryService(this._serviceUuid);
        }).
        then((service) => {
          this._log('Service found', 'Getting characteristic...');
          this._service = service;
          return this._service.getCharacteristic(this._characteristicUuidTx);
        }).
        then((characteristicTx) => {
          this._log('CharacteristicTx found');
          this._characteristicTx = characteristicTx; // Remember characteristic.
          return this._service.getCharacteristic(this._characteristicUuidRx);
        }).
        then((characteristicRx) => {
          this._log('CharacteristicRx found');
          this._characteristicRx = characteristicRx; // Remember characteristic.
          return [this._characteristicTx, this._characteristicRx];
        });
  }

  /**
   * Start notifications.
   * @param {Object} characteristic
   * @return {Promise}
   * @private
   */
  _startNotifications(characteristic) {
    this._log('Starting notifications...');

    return characteristic.startNotifications().
        then(() => {
          this._log('Notifications started');

          characteristic.addEventListener('characteristicvaluechanged',
              this._boundHandleCharacteristicValueChanged);
        });
  }

  /**
   * Stop notifications.
   * @param {Object} characteristic
   * @return {Promise}
   * @private
   */
  _stopNotifications(characteristic) {
    this._log('Stopping notifications...');

    return characteristic.stopNotifications().
        then(() => {
          this._log('Notifications stopped');

          characteristic.removeEventListener('characteristicvaluechanged',
              this._boundHandleCharacteristicValueChanged);
        });
  }

  /**
   * Handle disconnection.
   * @param {Object} event
   * @private
   */
  _handleDisconnection(event) {
    const device = event.target;

    this._log('"' + device.name +
        '" bluetooth device disconnected, trying to reconnect...');

    this._connectDeviceAndCacheCharacteristic(device).
        then((characteristic) => this._startNotifications(characteristic)).
        catch((error) => this._log(error));
  }

  /**
   * Handle characteristic value changed.
   * @param {Object} event
   * @private
   */
  _handleCharacteristicValueChanged(event) {

    const value = new TextDecoder().decode(event.target.value);

    for (const c of value) {
      if (c === this._receiveSeparator) {
        const data = this._receiveBuffer.trim();

        this._receiveBuffer = '';

        if (data) {
          this.receive(data);
        }
      } else {
        this._receiveBuffer += c;
      }
    }
  }

  /**
   * Write to characteristic.
   * @param {Object} characteristic
   * @param {string} data
   * @return {Promise}
   * @private
   */
  _writeToCharacteristic(characteristic, data) {
    let ret = characteristic.writeValue(new TextEncoder().encode(data));
    return ret;
  }

  /**
   * Log.
   * @param {Array} messages
   * @private
   */
  _log(...messages) {
    console.log(...messages); // eslint-disable-line no-console
  }

  /**
   * Split by length.
   * @param {string} string
   * @param {number} length
   * @return {Array}
   * @private
   */
  static _splitByLength(string, length) {
    return string.match(new RegExp('(.|[\r\n]){1,' + length + '}', 'g'));
  }
}

// Export class as a module to support requiring.
/* istanbul ignore next */
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = BluetoothTerminal;
}
