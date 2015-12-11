describe('GethConnector', function () {
  let gethObj;
  beforeAll(function () {
    gethObj = GethConnector.getInstance();
  });

  beforeEach(function () {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;
  });

  it('can init connector', function () {
    expect(gethObj).toBeDefined();
  });

  it('can start geth process', function (done) {
    if (gethObj.start()) {
      expect(gethObj.dataDir).toBeDefined();
      expect(gethObj.ethConnector).toBe(true);
      done();
    } else {
      fail('could not start geth');
    }
  });

  describe("geth ipc", function () {
    beforeEach(function (done) {
      if (!gethObj.isRunning()) {
        let isRunning = gethObj.start();
        if (isRunning) {
          done();
        }
      } else {
        done();
      }
    });

    afterEach(function(){
      gethObj.stop();
    });

    it('can connect to ipc', function (done) {
      gethObj.connectToIPC();
      expect(gethObj.socket.writable).toBe(true);
      done();
    });

    it('can list accounts', function (done) {
      gethObj.ipcCall('personal_listAccounts', [], Meteor.bindEnvironment(function (err, resp) {
        expect(err).toBe(null);
        expect(resp).toBeDefined();
        done();
      }));
    });

    it('can get peers', function(done){
      gethObj.ipcCall('net_listening', [], Meteor.bindEnvironment(function (err, resp) {
        expect(err).toBe(null);
        expect(resp).toBeDefined();
        done();
      }));
    });

    it('can get peer count', function(done){
      gethObj.ipcCall('net_peerCount', [], Meteor.bindEnvironment(function (err, resp) {
        expect(err).toBe(null);
        expect(resp).toBeDefined();
        done();
      }));
    })
  });

});
