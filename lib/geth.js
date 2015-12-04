const binariesVersion = '0.0.1';

const path = Npm.require('path');
const net  = Npm.require('net');

const platform   = process.platform;
const projectDir = process.env.PWD + '/';

const assetsDir  = '.private';
const execPath   = path.join(projectDir, assetsDir);
const gethFolder = 'assets';
const assetsRoot = 'https://github.com/AkashaProject/geth-testnet/releases/download/';

let idCount = 1;

const log = loglevel.createPackageLogger('akasha:meteor-geth', defaultLevel = 'info');

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
   * @param executable
   */
  constructor (executable) {
    check(executable, Match.Optional(String));
    if (!executable) {
      this.executable = path.join(execPath, gethFolder, ((platform == 'win32') ? 'geth.exe' : 'geth'));
    } else {
      this.executable = executable;
    }

    this.childProcess = new LongRunningChildProcess('gethProcess');
    this.socket       = new net.Socket();
    this.ipcCallbacks = {};

    this.ethConnector = false;
    this.dataDir      = false;

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
      log.warn('connection to ipc closed');
      this._ipcDestroy();
    });

    this.socket.on('timeout', (e)=> {
      log.warn('connection to ipc timed out');
      this._ipcDestroy();
    });

    this.socket.on('end', (e)=> {
      log.warn('i/o to ipc ended');
      this._ipcDestroy();
    });

  }

  /**
   * Spawn long running child process for geth
   * @param dataDir
   * @param testNet
   * @param extraOptions
   * @returns {object}
   */
  start (dataDir, testNet = true, extraOptions = ['--shh', '--rpc', '--rpccorsdomain', 'localhost']) {
    check(dataDir, Match.Optional(String));
    check(testNet, Boolean);
    check(extraOptions, isArray);
    let options       = [];
    const genesisFile = path.join(execPath, gethFolder, '/datadir/genesis.json');
    const password    = path.join(execPath, gethFolder, 'password.txt');

    if (dataDir) {
      this.dataDir = dataDir;
    } else {
      this.dataDir = path.join(execPath, 'datadir');
    }
    options.push('--datadir', this.dataDir);

    if (testNet) {
      options.push('--genesis', genesisFile,
        '--networkid', 777,
        '--unlock', '0',
        '--password', password,
        '--nodiscover',
        '--maxpeers', '0');
    }

    if (extraOptions.constructor === Array) {
      options.concat(extraOptions);
    }

    if (!this.ethConnector) {
      let optionsObj = {
        command: this.executable,
        args:    options
      };
      this._getAssets(
        (err, done)=> {
          if (!err && done) {
            log.info('starting geth from ' + this.executable);
            this.ethConnector = this.childProcess.spawn(optionsObj);
          }
        }
      );
    }
  }

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

  stop () {
    log.info('stopping geth process & closing ipc connection');
    this._kill();
    log.info('done');
  }

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
  _getAssets (cb) {
    check(cb, isFunction);
    const gethPath = path.join(execPath, 'geth-testnet' + binariesVersion + '.zip');

    /** create .private dir **/
    Fse.mkdirp(assetsDir);

    /** verify if there is a previous dowload of geth **/
    Fse.stat(gethPath, (err, stats)=> {
      if (!stats) {
        /** cleanup old versions of geth **/
        this._delZip();
        /** ENOENT **/
        if (err.errno == 34) {
          const file = Fse.createWriteStream(gethPath);
          Request.get(binaries[platform]).on('response', function (response) {

            /** nice message for download **/
            if (response.statusCode == 200) {
              console.log('====Started to download geth binaries===');
            }
          }).on('error', function (error) {

            console.log('!!!Could not download geth binaries!!!');
            return cb('download-failed', null);
          }).pipe(file).on('finish', function () {
            console.log('====download completed...unzipping files...====');

            /** extract .zip contents to .private/assets **/
            let zip = new AdmZip(gethPath);
            zip.extractAllTo(execPath);

            /** just to be sure that geth is executable **/
            Shelljs.chmod('+x', path.join(execPath, gethFolder,
              ((platform == 'win32') ? 'geth.exe' : 'geth')));
            console.log('finished');
            return cb(null, true);
          });
        }
      } else {
        return cb(null, true);
      }
    });
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
}
;
