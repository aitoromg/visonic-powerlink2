var request = require("request");
var oneConcurrent = require("one-concurrent");

/**
 * Allows you to get and set the status of a Visonic security system (i.e. arm or disarm it) via its PowerLink2 communication module
 * 
 * @constructor
 * @param {Object} config - Config object, containing a 'username', 'password', 'host' (e.g. IP address string), and optionally a 'debug' boolean
 * @param {Function} [log] - Optional logging function
 */
function PowerLink2(config, log) {
	let self = this;

	self.failSafe = false; // failSafe will be turned on when authentication fails; it will cause further authentication attempts to be aborted, to prevent the PowerLink2 locking out your account for a huge amount of time

	self.log = log || console.log; // Allow a custom logging function, else default to console.log
	
	self.debug = config.debug;

	self.baseURL = 'http://' + config.host; // Would use HTTPS, but the connection fails to handshake
	self.username = config.username;
	self.password = config.password;

	self.timeout = config.timeout || 2500;
}

PowerLink2.STATUSES = {
	DISARMED: 'disarmed',
	ARMED_HOME: 'home',
	ARMED_AWAY: 'away',
	EXIT_DELAY: 'exit delay', // Can only get, not set, this status. Occurs when the system has begun arming; allowing people to exit.
	UNKNOWN: 'unknown' // Can only get, not set, this status.
}

/**
 * Get the current system status
 * 
 * @param  {Function} callback - Callback to call with the status or error (error, status). Status will be a value from PowerLink2.STATUSES
 */
PowerLink2.prototype.getStatus = function (callback) {
	var self = this;

	self.authenticatedRequest({
		url: self.baseURL + '/web/ajax/alarm.chkstatus.ajax.php',
		method: 'POST',
		form: {
			curindex: self.getStatusIndex || '0',
			sesusername: self.username,
			sesusermanager: '1'
		}
	},
	function(error, response, body) {

		if (error) {
			callback(new Error(`Error getting raw status: ${error}`));
			return;
		}

		if (self.debug) {
			self.log(`Response from getRawState HTTP call:`)
			self.log(`response: ${response}`)
			self.log(`body: ${body}`)
		}

		var noChange = body.match(/<customStatus>\[NOCNG\]<\/customStatus>/);
		if (noChange) {
			self.log(`Status hasn't changed– returning last status`);
			callback(null, self.lastStatus);
			return;
		}

		var indexMatch = body.match(/<index>([^]+?)<\/index>/);
		if (indexMatch) {
			self.getStatusIndex = indexMatch[1];
			self.debugLog(`getStatusIndex: ${self.getStatusIndex}`);
		}

		var statusString = body.match(/<system>[^]+<status>([^]+)<\/status>[^]+<\/system>/)[1];
		// statusString = "Ready" / "HOME" / "AWAY" / unexpected

		let statusStringToStatus = {
			'Ready': PowerLink2.STATUSES.DISARMED,
			'NotReady': PowerLink2.STATUSES.DISARMED,
			'Exit Delay': PowerLink2.STATUSES.EXIT_DELAY,
			'HOME': PowerLink2.STATUSES.ARMED_HOME,
			'AWAY': PowerLink2.STATUSES.ARMED_AWAY,
		}

		let status = statusStringToStatus[statusString] || PowerLink2.STATUSES.UNKNOWN;
		self.lastStatus = status;

		callback(error, status);
	});
}

/**
 * Sets the system status (i.e. arms or disarms the system)
 * 
 * @param {string} status - The status to set. Use a value from PowerLink2.STATUSES
 * @param {Function} callback - Callback to call (error)
 */
PowerLink2.prototype.setStatus = function (status, callback) {
	var self = this;

	let stringMap = {};
	stringMap[PowerLink2.STATUSES.DISARMED] = 'Disarm';
	stringMap[PowerLink2.STATUSES.ARMED_HOME] = 'ArmHome';
	stringMap[PowerLink2.STATUSES.ARMED_AWAY] = 'ArmAway';

	let statusString = stringMap[status]; // Get the right string for use in the API call

	if (statusString == undefined) {
		callback(new Error(`Cannot set status to: ${status}`)); // For example: PowerLink2.STATUSES.EXIT_DELAY
		return;
	}

	self.authenticatedRequest({
		url: self.baseURL + '/web/ajax/security.main.status.ajax.php',
		method: 'POST',
		form: {
			'set': statusString
		}
	}, 
	function (error, response, body) {

		self.debugLog(`Got setStatus HTTP response body: ${body}`)

		callback(error);
	});
}

/**
 * Logs in, and gets the cookie
 * 
 * @private
 * @param  {Function} callback - Callback to call with the cookie string (error, cookie)
 */
PowerLink2.prototype.getAuthenticationCookie = function (callback) {
	var self = this;

	// "Mmmm, yummy!" – Manila Luzon

	if (self.failSafe) {
		callback(new Error("A previous authentication attempt failed; not continuing."));
		return;
	}

	if (self.cookie != null) { // Do we already have an authentication cookie from before?
		callback(null, self.cookie);
		return;
	}

	request({
		url: self.baseURL + '/web/ajax/login.login.ajax.php',
		method: 'POST',
		form: {
			user: self.username,
			pass: self.password
		},
		timeout: self.timeout
	}, 
	function(error, response, body) {

		if (self.debug) {
			self.log(`Response from getAuthenticationCookie HTTP call:`)
			self.log(`error: ${error}`)
			self.log(`response: ${response}`)
			self.log(`body: ${body}`)
		}

		if (error) { callback(error); return; }

		// Check whether an error message got returned in the response body
		if (body.match(/NOT::/) != null) {

			self.failSafe = true; // Prevent further authentication attempts

			var errorReason = "Invalid PowerLink2 username or password provided"; // Default reason

			let lockedOut = body.match(/time left:(.+)/); // Are you locked out, likely due to repeated failed login attempts?
			if (lockedOut) { errorReason = `Locked out for ${lockedOut[1]}. Ensure username and password are correct, and restart Homebridge once the lockout time has elapsed.`; }

			self.log(errorReason);
			callback(new Error(errorReason));
			return;
		}

		let cookie = response.headers['set-cookie'][0].match(/(.+);/)[1];
		self.cookie = cookie
		self.debugLog(`Got authentication cookie: ${cookie}`);

		callback(null, cookie);
	});
}

/**
 * Makes a HTTP request using the 'request' module, first injecting the stored authentication cookie (or grabbing one first if required)
 *
 * @private
 * @param {Object} config - Configuration object, in the format that the 'request' module expects
 * @param {Function} callback - Callback to call (error, response, body)
 */
PowerLink2.prototype.authenticatedRequest = function (config, callback) {
	let self = this;

	oneConcurrent(function (callback) {
		self.getAuthenticationCookie(callback);

	}, function (error, cookie) {

		if (error) { 
			callback(new Error(`Failed to get authentication cookie: ${error}`)); 
			return; 
		}

		config.headers = config.headers || {};
		config.headers['Cookie'] = cookie

		config.timeout = config.timeout || self.config.timeout;

		request(config, function (error, response, body) {

			if (!error) {

				// Check whether we're not logged in anymore
				if (body == '' || body.match(/\[RELOGIN\]/)) {

					self.debugLog(`Our cookie probably isn't valid anymore - let's get another one`);

					self.cookie = null; // Invalidate the cookie we have

					setTimeout(function () {
						self.authenticatedRequest(config, callback); // Re-run this request, fetching a new cookie in the meantime
					}, 3*1000); // Sane retry delay
					
					return;
				}
			}

			callback(error, response, body); // Continue as normal
		});
	});
}

/** 
 * Logging function which will only actually log if self.debug is true. Can be passed anything you'd pass to config.log
 * 
 * @private
 * @param {...*} value - Value to log
 */
PowerLink2.prototype.debugLog = function () {
	let self = this;
	
	if (self.debug) 
		self.log.apply(self, arguments);
}

module.exports = PowerLink2;