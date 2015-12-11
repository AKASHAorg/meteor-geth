const binariesVersion = '0.0.2';

const path      = Npm.require('path');
const net       = Npm.require('net');
const Future    = Npm.require('fibers/future');
const writeJson = Meteor.wrapAsync(Fse.outputJson);

const platform   = process.platform;
const projectDir = process.env.PWD + '/';

const assetsDir  = '.private';
const configFile = 'geth.json';
const execPath   = path.join(projectDir, assetsDir);
const gethFolder = 'assets';
const assetsRoot = 'https://github.com/AkashaProject/geth-testnet/releases/download/';

let idCount = 1;

const symbolEnforcer = Symbol();
const symbol         = Symbol();

const log = loglevel.createPackageLogger('akasha:meteor-geth', defaultLevel = 'info');
const logLevels = ['trace', 'fine', 'debug', 'info', 'warn', 'error'];

const binaries = {
  'linux':  assetsRoot + binariesVersion + '/geth-testnet-linux-x64.zip',
  'darwin': assetsRoot + binariesVersion + '/geth-testnet-macosx-x64.zip',
  'win32':  assetsRoot + binariesVersion + '/geth-testnet-win-x64.zip'
};

const isBuffer = Match.Where(function (x) {
  return Buffer.isBuffer(x);
});

const isArray = Match.Where(function (x) {
  return Array.isArray(x);
});

const isFunction = Match.Where(function (x) {
  return typeof(x) === 'function';
});

GethConnector = class GethConnector {

  /**
   *
   * @param enforcer
   */
  constructor (enforcer) {
    if (enforcer !== symbolEnforcer) {
      throw new Meteor.Error('singleton-enforce', 'Cannot construct singleton');
    }

    this.childProcess = new LongRunningChildProcess('gethProcess');
    this.socket       = new net.Socket();
    this.ipcCallbacks = {};

    this.ethConnector = false;
    this.dataDir      = false;
    this.config       = false;
    this.options      = [];

    this.lastChunk        = null;
    this.lastChunkTimeout = null;

    this.socket.on('error', function (error) {
      log.error(error);
    });


    this.socket.on('data', (data)=> {
      this._deChunker(data, (error, response)=> {
        if (!error) {
          let cb = this.ipcCallbacks[response.id];
          if (response.result) {
            cb(null, response.result);
          } else {
            cb(response.error, null);
          }
          delete this.ipcCallbacks[response.id];
        }
      });
    });

    this.socket.on('connect', function () {
      log.info('connection to ipc Established!');
    });

    this.socket.on('close', ()=> {
      log.info('connection to ipc closed');
      this._ipcDestroy();
    });

    this.socket.on('timeout', (e)=> {
      log.warn('connection to ipc timed out');
      this._ipcDestroy();
    });

    this.socket.on('end', (e)=> {
      log.info('i/o to ipc ended');
    });

  }

  static getInstance () {
    if (!this[symbol]) {
      this[symbol] = new GethConnector(symbolEnforcer);
    }
    return this[symbol];
  }

  /**
   *
   * @returns {*}
   */
  start () {
    if (this.options.length == 0) {
      this.setOptions();
    }
    if (!this.ethConnector) {
      let gethProc   = new Future();
      let optionsObj = {
        command: this.executable,
        args:    this.options
      };
      let config     = this._checkConfig();

      if (config) {
        log.info('starting geth from ' + this.executable);
        this.childProcess.spawn(optionsObj);
        this.ethConnector = true;
        Meteor.setTimeout(()=> {
          gethProc.return(this.ethConnector);
        }, 4000);
      } else {
        gethProc.throw(err);
      }

      return gethProc.wait();
    }
    return this.ethConnector;
  }

  /**
   *
   * @param executable
   * @param dataDir
   * @param privateNet
   * @param testNet
   * @param extraOptions
   */
  setOptions ({executable, dataDir, privateNet = true, testNet = false,
    extraOptions = ['--shh', '--rpc', '--rpccorsdomain', 'localhost']} = {}) {
    check(dataDir, Match.Optional(String));
    check(testNet, Boolean);
    check(extraOptions, isArray);
    check(executable, Match.Optional(String));

    let options = [];
    if (!executable) {
      this.executable = path.join(execPath, gethFolder,
        ((platform == 'win32') ? 'geth.exe' : 'geth'));
    } else {
      this.executable = executable;
    }

    if (dataDir) {
      this.dataDir = dataDir;
    } else {
      this.dataDir = path.join(execPath, gethFolder, 'datadir');
    }
    options.push('--datadir', this.dataDir);

    if (privateNet) {
      options.push('--genesis', path.join(execPath, gethFolder, '/datadir/genesis.json'),
        '--networkid', 777,
        '--unlock', '0',
        '--password', path.join(execPath, gethFolder, 'password.txt'),
        '--nodiscover',
        '--maxpeers', '0');
    }

    /** Morden **/
    if (testNet) {
      options.push('--testnet');
    }

    if (extraOptions.constructor === Array) {
      options = options.concat(extraOptions);
    }
    this.options = options;
  }

  /**
   *
   * @returns {boolean}
   */
  isRunning () {
    return this.ethConnector;
  }

  /**
   *
   */
  connectToIPC () {
    /** verify if there is a working connection already **/
    if (!this.socket.writable) {
      this.socket.connect({path: path.join(this.dataDir, 'geth.ipc')});
    }
  }

  /** https://github.com/ethereum/mist/blob/develop/modules/ipc/nodeConnector.js **/
  ipcCall (name, params, callback) {
    check(name, String);
    check(params, isArray);
    check(callback, isFunction);
    if (!this.ethConnector) {
      let msg = 'geth process not started, use .start() before';
      log.warn(msg);
      callback(msg, null);
    }

    this.connectToIPC();
    if (this.socket.writable) {
      this.ipcCallbacks[idCount] = callback;
      this.socket.write(JSON.stringify({
        jsonrpc: '2.0',
        id:      idCount,
        method:  name,
        params:  params || []
      }));

      idCount++;
    } else {
      callback('Socket not writeable', null);
    }
  }

  /**
   *
   */
  stop () {
    log.info('stopping geth process & closing ipc connection');
    this._kill();
    log.info('done');
  }

  /**
   *
   * @private
   */
  _ipcDestroy () {
    this.socket.destroy();
  }

  /** https://github.com/ethereum/mist/blob/develop/modules/ipc/dechunker.js **/
  _deChunker (data, callback) {
    check(data, isBuffer);
    check(callback, isFunction);
    data              = data.toString();
    let dechunkedData = data
      .replace(/\}[\n\r]?\{/g, '}|--|{') // }{
      .replace(/\}\][\n\r]?\[\{/g, '}]|--|[{') // }][{
      .replace(/\}[\n\r]?\[\{/g, '}|--|[{') // }[{
      .replace(/\}\][\n\r]?\{/g, '}]|--|{') // }]{
      .split('|--|');

    _.each(dechunkedData, function (chunk) {

      if (this.lastChunk) {
        chunk = this.lastChunk + chunk;
      }

      let result = chunk;

      try {
        result = JSON.parse(result);
      } catch (e) {
        this.lastChunk = chunk;
        clearTimeout(this.lastChunkTimeout);
        this.lastChunkTimeout = setTimeout(function () {
          callback('Couldn\'t decode data: ' + chunk);
        }, 1000 * 15);
        return;
      }

      clearTimeout(this.lastChunkTimeout);
      this.lastChunk = null;

      callback(null, result);
    });
  }

  /**
   * downloads and updates geth executable
   * @private
   */
  _getAssets (force = false) {
    check(force, Boolean);
    if (force || (this.config.version != binariesVersion)) {
      const gethPath = path.join(execPath, 'geth-testnet' + binariesVersion + '.zip');
      const future   = new Future();

      /** create .private dir **/
      Shelljs.mkdir('-p', execPath);
      const file = Fse.createWriteStream(gethPath);

      Request.get(binaries[platform]).on('response', function (response) {

        /** nice message for download **/
        if (response.statusCode == 200) {
          log.info('====Started to download geth binaries===');
        }
      }).on('error', function (error) {

        log.info('!!!Could not download geth binaries!!!');
        future.throw(true);
      }).pipe(file).on('finish', ()=> {
        log.info('====download completed...unzipping files...====');

        /** extract .zip contents to .private/assets **/
        let zip = new AdmZip(gethPath);
        zip.extractAllTo(execPath);

        /** just to be sure that geth is executable **/
        Shelljs.chmod('+x', path.join(execPath, gethFolder,
          ((platform == 'win32') ? 'geth.exe' : 'geth')));
        log.info('finished');

        this._delZip();
        future.return(true);
      });
      return future.wait();
    }
    return false;
  }

  /**
   * kill child process & cleanup
   * @private
   */
  _kill () {
    this._ipcDestroy();
    this.childProcess.kill();
    this.ethConnector = false;
  }

  /**
   * delete geth archives
   * @private
   */
  _delZip () {
    Shelljs.rm('-rf', path.join(execPath, 'geth-testnet*.zip'));
  }

  /**
   * write current ipfs version
   * @private
   */
  _writeToConfig () {
    writeJson(path.join(execPath, configFile), {version: binariesVersion}, Meteor.bindEnvironment((error)=> {
      if (error) {
        log.error('could not write to ipfs.json');
      } else {
        this.config = {version: binariesVersion};
      }
    }));
  }

  /**
   *
   * @returns {*|any}
   * @private
   */
  _checkConfig () {
    const future = new Future();
    Fse.stat(path.join(execPath, configFile), Meteor.bindEnvironment((err, stats)=> {
      if (!stats) {
        if (this._getAssets(true)) {
          this._writeToConfig();
          return future.return(true);
        }
        return future.throw(true);
      }
      Fse.readJson(path.join(execPath, configFile), Meteor.bindEnvironment((er, config)=> {
        if (er) {
          future.throw(er);
        } else {
          this.config = config;

          if (this._getAssets()) {
            this._writeToConfig();
            return future.return(true);
          }
          return future.return(true);
        }
      }));

    }));
    return future.wait();
  }

  /**
   *
   * @param level from $logLevels
   */
  setLogLevel (level = 'info') {
    if (logLevels.indexOf(level) != -1) {
      log.setLevel(level);
    } else {
      log.error('level not from logLevels ', logLevels);
    }

  }
};
