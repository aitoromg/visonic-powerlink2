# visonic-powerlink2

Allows you to get and set the status of a Visonic security system (i.e. arm or disarm it) via its PowerLink2 communication module

## Install

```bash
$ npm install --save visonic-powerlink2
```

## Usage

```javascript
var PowerLink2 = require("visonic-powerlink2");

var powerLink2 = new PowerLink2({
	host: "10.0.1.200",
	username: "your-username",
	password: "your-password"
});

powerLink2.getStatus(function (error, status) {

	if (error) {
		console.log(`Error getting status: ${error}`);
		return;
	}

	console.log(`Status: ${status}`); //=> Status: disarmed
});

powerLink2.setStatus(PowerLink2.STATUSES.ARMED_HOME, function (error) {

	if (error) {
		console.log(`Error getting status: ${error}`);
		return;
	}

	console.log(`Status set successfully`);
});

```

## API

### PowerLink2

#### STATUSES

Map of possible statuses

* `DISARMED`
* `ARMED_HOME`
* `ARMED_AWAY`
* `EXIT_DELAY` – Can only get, not set, this status. Occurs when the system has begun arming; allowing people to exit.
* `UNKNOWN` – Can only get, not set, this status.

#### new PowerLink2(config, [log])

* `config` **Object**

	- `host` **string** – The IP address, or hostname, of the PowerLink2. (The IP address will match your router's, but with the last block being `.200`, if DHCP is used)

	- `username` **string** and `password` **string** – The details to log into the PowerLink2 with. By default, they're `Admin` and `Admin123` respectively. (Be sure to change the password!)

	- `debug` optional **boolean** – Turns on extensive logging, to help debug issues, when set to `true` (default: `false`)

* `log` optional **Function** - Logging function

**getStatus(callback)**

Get the current system status

* `callback` **Function** - Callback to call with the status or error (error, status). Status will be a value from `PowerLink2.STATUSES`

**setStatus(status, callback)**

Sets the system status (i.e. arms or disarms the system)

* `status` **string** - The status to set. Use a value from `PowerLink2.STATUSES`
* `callback` **Function** - Callback to call (error)