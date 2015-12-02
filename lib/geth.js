const binariesVersion = '0.0.1';

const path = Npm.require('path');

const platform   = process.platform;
const projectDir = process.env.PWD + '/';
const dataDir    = '.private';
const execPath   = path.join(projectDir, dataDir);
const gethFolder = 'assets';

const assetsRoot = 'https://github.com/AkashaProject/geth-testnet/releases/download/';
const binaries   = {
  'linux':  assetsRoot + binariesVersion + '/geth-testnet-linux-x64.zip',
  'darwin': assetsRoot + binariesVersion + '/geth-testnet-macosx-x64.zip',
  'win32':  assetsRoot + binariesVersion + '/geth-testnet-win-x64.zip'
};


GethConnector = class GethConnector {

  /**
   * @method constructor
   * @param  {[type]}    autoStart  = false [description]
   * @param  {[type]}    executable = false [description]
   * @return {[type]}    [description]
   */
  constructor (autoStart = false, executable = false) {
    if (!executable) {
      this.executable = path.join(execPath, gethFolder, ((platform == 'win32') ? 'geth.exe' : 'geth'));
    } else {
      this.executable = executable;
    }

    this.childProcess = new LongRunningChildProcess('gethProcess');
    this.ethConnector = false;
    this.dataDir      = false;

    if (autoStart) {
      this.start();
    }
  }

  /**
   * Spawn long running child process for geth
   * @param dataDir
   * @param testNet
   * @param extraOptions
   * @returns {object}
   */
  start (dataDir, testNet = true, extraOptions = ['--shh', '--rpc', '--ipcdisable',
    '--rpcapi', 'eth,web3,shh,miner',
    '--rpccorsdomain', '*']) {

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
      });
    }
  }


  /**
   * downloads and updates geth executable
   * @private
   */
  _getAssets (cb) {
    const gethPath = path.join(execPath, 'geth-testnet' + binariesVersion + '.zip');
    Fse.mkdirp(dataDir);
    Fse.stat(gethPath, (err, stats)=> {
      if (!stats) {
        this._delZip();
        if (err.errno == 34) {
          const file = Fse.createWriteStream(gethPath);
          Request.get(binaries[platform]).on('response', function (response) {
            if (response.statusCode == 200) {
              console.log('====Started to download geth binaries===');
            }
          }).on('error', function (err) {
            console.log('!!!Could not download geth binaries!!!');
            return cb('download-failed', null);
          }).pipe(file).on('finish', function () {
            console.log('====download completed...unzipping files...====');
            let zip = new AdmZip(gethPath);
            zip.extractAllTo(execPath);
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
   * kill child process
   */
  _kill () {
    this.ethConnector.kill();
    this.ethConnector = false;
  }

  /**
   *
   * @private
   */
  _delZip () {
    Shelljs.rm('-rf', path.join(execPath, 'geth-testnet*.zip'));
  }
};
