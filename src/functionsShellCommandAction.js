"use strict";

var repl = require("repl");
var _ = require("lodash");

var request = require("request");
var util = require("util");

var serveFunctions = require("./serve/functions");
var LocalFunction = require("./localFunction");
var utils = require("./utils");
var logger = require("./logger");
var shell = require("./emulator/functionsEmulatorShell");
var commandUtils = require("./emulator/commandUtils");
var { ALL_SERVICE_EMULATORS } = require("./emulator/types");
var { EmulatorHubClient } = require("./emulator/hubClient");

module.exports = async function(options) {
  options.port = parseInt(options.port, 10);

  let debugPort = undefined;
  if (options.inspectFunctions) {
    debugPort = commandUtils.parseInspectionPort(options);
  }

  const hubClient = new EmulatorHubClient(options.project);
  let remoteEmulators = {};
  if (hubClient.foundHub()) {
    remoteEmulators = await hubClient.getEmulators();
    logger.debug("Running emulators: ", remoteEmulators);
  }

  for (const e of ALL_SERVICE_EMULATORS) {
    const info = remoteEmulators[e];
    if (info) {
      utils.logBullet(`Connecting to running ${e} emulator at ${info.host}:${info.port}`);
    }
  }

  return serveFunctions
    .start(options, {
      // TODO(samstern): Note that these are not acctually valid FunctionsEmulatorArgs
      // and when we eventually move to all TypeScript we'll have to start adding
      // projectId and functionsDir here.
      quiet: true,
      remoteEmulators,
      debugPort,
    })
    .then(function() {
      return serveFunctions.connect();
    })
    .then(function() {
      const instance = serveFunctions.get();
      const emulator = new shell.FunctionsEmulatorShell(instance);

      if (emulator.emulatedFunctions && emulator.emulatedFunctions.length === 0) {
        logger.info("No functions emulated.");
        process.exit();
      }

      var writer = function(output) {
        // Prevent full print out of Request object when a request is made
        if (output instanceof request.Request) {
          return "Sent request to function.";
        }
        return util.inspect(output);
      };

      var prompt = "firebase > ";

      var replServer = repl.start({
        prompt: prompt,
        writer: writer,
        useColors: true,
      });
      _.forEach(emulator.triggers, function(trigger) {
        if (_.includes(emulator.emulatedFunctions, trigger.name)) {
          var localFunction = new LocalFunction(trigger, emulator.urls, emulator);
          var triggerNameDotNotation = trigger.name.replace(/\-/g, ".");
          _.set(replServer.context, triggerNameDotNotation, localFunction.call);
        }
      });
      replServer.context.help =
        "Instructions for the Functions Shell can be found at: " +
        "https://firebase.google.com/docs/functions/local-emulator";
    })
    .then(function() {
      return new Promise(function(resolve) {
        process.on("SIGINT", function() {
          return serveFunctions
            .stop()
            .then(resolve)
            .catch(resolve);
        });
      });
    });
};
