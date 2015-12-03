const binariesVersion = '0.0.1';

const path = Npm.require('path');
const net  = Npm.require('net');

const platform   = process.platform;
const projectDir = process.env.PWD + '/';

const dataDir    = '.private';
const execPath   = path.join(projectDir, dataDir);
const gethFolder = 'assets';
const assetsRoot = 'https://github.com/AkashaProject/geth-testnet/releases/download/';

let idCount = 1;

const binaries = {
  'linux':  assetsRoot + binariesVersion + '/geth-testnet-linux-x64.zip',
  'darwin': assetsRoot + binariesVersion + '/geth-testnet-macosx-x64.zip',
  'win32':  assetsRoot + binariesVersion + '/geth-testnet-win-x64.zip'
};


GethConnector = class GethConnector {

  /**
   *
   * @param executable
   */
  constructor (executable = false) {
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
      console.log('NODECONNECTOR ERROR', error);
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
      console.log('connection to ipc Established!');
    });

    this.socket.on('close', ()=> {
      this._ipcDestroy();
    });

    this.socket.on('timeout', (e)=> {
      this._ipcDestroy();
    });

    this.socket.on('end', (e)=> {
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
      this._getAssets((err, done)=> {
          if (!err && done) {
            console.log('starting geth from ' + this.executable);
            this.ethConnector = this.childProcess.spawn(optionsObj);
          }
        }
      );
    }
  }

  connectToIPC () {

    if (!this.socket.writable) {
      this.socket.connect({path: path.join(this.dataDir, 'geth.ipc')});
    }
  }

  ipcCall (name, params, callback) {
    if (!callback || typeof callback !== "function") {
      throw new Meteor.Error("callback-required", "must provide callback function");
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

  _ipcDestroy () {
    this.socket.destroy();
  }

  /** https://github.com/ethereum/mist/blob/develop/modules/ipc/dechunker.js **/
  _deChunker (data, callback) {
    data              = data.toString();
    let dechunkedData = data
      .replace(/\}[\n\r]?\{/g, '}|--|{') // }{
      .replace(/\}\][\n\r]?\[\{/g, '}]|--|[{') // }][{
      .replace(/\}[\n\r]?\[\{/g, '}|--|[{') // }[{
      .replace(/\}\][\n\r]?\{/g, '}]|--|{') // }]{
      .split('|--|');


    _.each(dechunkedData, function (data) {

      if (this.lastChunk)
        data = this.lastChunk + data;

      let result = data;

      try {
        result = JSON.parse(result);
      } catch (e) {
        this.lastChunk = data;
        clearTimeout(this.lastChunkTimeout);
        this.lastChunkTimeout = setTimeout(function () {
          callback('Couldn\'t decode data: ' + data);
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
    const gethPath = path.join(execPath, 'geth-testnet' + binariesVersion + '.zip');

    /** create .private dir **/
    Fse.mkdirp(dataDir);

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
          }).on('error', function (err) {

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
   */
  _kill () {
    this.childProcess.kill();
    this._ipcDestroy();
    this.ethConnector = false;
  }

  /**
   *
   * @private
   */
  _delZip () {
    Shelljs.rm('-rf', path.join(execPath, 'geth-testnet*.zip'));
  }
}
;
