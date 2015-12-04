# This package is for [ethereum](https://ethereum.org/) dapp development

## What's does this package:
 * Exports a global class named `GethConnector` available only on **server**
 * Downloads geth binaries
 * Can start geth process
 * Can connect to an ipc geth process and send  [json-rpc](http://https://github.com/ethereum/wiki/wiki/JSON-RPC#json-rpc-methods) call

## How to use it

 * On server side create a global variable just before `Meteor.startup`:
   ```
   gethObj = false;
   Meteor.startup(function () {
   	gethObj = new GethConnector(); //you can pass geth executable location as param also
   }
   ```
 * Then you can use anywhere on server side these methods:
  ```
  gethObj.start(); //start geth process, you can find logs in .meteor/local/log/gethProcess.log
  ```
  there are some params you can send when starting get, these are the default ones:
  ```
  gethObj.start(dataDir, testNet = true, extraOptions = ['--shh', '--rpc', '--rpccorsdomain', 'localhost'])
  ```
  ```
  gethObj.stop();//stop geth process
  ```
  ```
  gethObj.ipcCall(name, params, callback));//send json-rpc request, you can find all available methods here http://https://github.com/ethereum/wiki/wiki/JSON-RPC#json-rpc-methods 
  ```
