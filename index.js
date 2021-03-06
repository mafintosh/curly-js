if (typeof XMLHttpRequest == 'undefined') {
	XMLHttpRequest = function () {
		try {
			return new ActiveXObject('Msxml2.XMLHTTP.6.0');
		} catch (e) {}
		try {
			return new ActiveXObject('Msxml2.XMLHTTP.3.0');
		} catch (e) {}
		try {
			return new ActiveXObject('Microsoft.XMLHTTP');
		} catch (e) {}
		
		// Microsoft.XMLHTTP points to Msxml2.XMLHTTP and is redundant
		throw new Error('This browser does not support XMLHttpRequest.');
	};
}
var noop = function() {};

var prefix = (new Date()).getTime().toString(36);
var cache = {};
var globalScope = window._tmp_jsonp = {}; // A global variable to reference jsonp closures
var cnt = 0;
var active = {};

window.onunload = function() {
	for (var i in active) {
		active[i].abort();
	}
};

var createDeferred = function() {
	var that = {};
	var stack = [];

	var action = function(method, path, data, callback) {
		callback = callback || noop;

		var send = function() {
			destroy = action(method, path, data, callback);
		};
		var destroy = function() {			
			for (var i = 0; i < stack.length; i++) {
				if (stack[i] === send) {
					stack.splice(i, 1);
					break;
				}
			}

			callback(new Error('request cancelled'));
		};

		stack.push(send);

		return function() {
			destroy();
		};
	};

	that.fulfilled = false;

	that.ready = function(fn) {
		that.fulfilled = true;
		action = fn;

		while (stack.length) {
			stack.shift()();
		}
	};
	that.send = function(a,b,c,d) {
		return action(a,b,c,d);
	};

	return that;
};

var hostify = function(address) {
	return address.match(/(http|https):\/\/([^\/]+)/).slice(1).join('://');
};
var addEvent = function(name, fn) {
	if (window.attachEvent) {
		window.attachEvent('on'+name, fn);
	} else {
		window.addEventListener(name, fn, false);
	}
};
var onbody = function(fn) {
	if (document.body) {
		fn();
	} else {
		addEvent('load', fn);
	}
};
var querify = function(query) {
	var result = '';

	for (var i in query) {
		if (result) {
			result += '&';
		}
		result += i+'='+encodeURIComponent(query[i]);
	}
	return result;
};
var send = function(method, path, data, ondone) {
	var xhr = new XMLHttpRequest();
	var id = ''+(++cnt);
	var called = false;

	var callback = function(err, value) {
		if (called) {
			return;
		}

		called = true;
		ondone(err, value);
	};

	active[id] = xhr;
	
	var tidy = function() {
		delete active[id];
		xhr.onreadystatechange = noop;		
	};
	var onresponse = function() {
		if (!/2\d\d/.test(xhr.status)) {
			var err = new Error('invalid status='+xhr.status);

			err.statusCode = xhr.status;
			callback(err);
			return
		}

		callback(null, xhr.responseText);
	};

	xhr.open(method, path, true);
	xhr.onreadystatechange = function() {
		if (xhr.readyState !== 4) {
			return;
		}

		tidy();
		setTimeout(onresponse, 1); // push it to the event stack
	};

	xhr.send(data);
	
	return function() {
		if (called) {
			return;
		}

		tidy();
		xhr.abort();
		callback(new Error('request aborted'));
	};
};
var proxy = function(url) {
	if (url.indexOf('://') === -1) {
		url = window.location.protocol+'//'+window.location.host+url;
	}
	if (cache[url]) {
		return cache[url];
	}

	var host = url.match(/^[^:]+:\/\/[^\/]+/i)[0];
	var deferred = createDeferred();
	var callbacks = {};

	var post = function() {
		var ifr = document.createElement('iframe');

		ifr.src = url;
		ifr.style.display = 'none';

		onbody(function() {
			document.body.appendChild(ifr);		
		});
		
		return function(message) {
			ifr.contentWindow.postMessage(JSON.stringify(message), '*');
			message = null; // no ie leaks					
		};
	}();
	var ready = function(method, path, data, callback) {
		var params = [method, path, data];
		var id = 's'+(cnt++);

		callback = callback || noop;
		callbacks[id] = function(err, result) {
			delete callbacks[id];

			callback(err, result);
		};

		post({name:'request', id:id, params:params});

		return function() {
			if (!callbacks[id]) {
				return;
			}

			post({name:'destroy', id:id});
			// this guard is need as the top call can sync cause mutations in callbacks (which is ok)
			(callbacks[id] || noop)(new Error('request cancelled'));
		};
	};

	addEvent('message', function(e) {
		if (e.origin !== host) {
			return;
		}
		if (!deferred.fulfilled) {
			deferred.ready(ready);
			return;
		}

		var message = JSON.parse(e.data);

		(callbacks[message.id] || noop)(message.error && new Error(message.error), message.result);				
		message = null; // no ie leaks
	});

	return cache[url] = function(method, path, data, callback) {
		return deferred.send(method, path, data, callback);
	};
};

var Request = function(method, url, send) {
	url = url.split('?');

	this._bust = true;
	this._send = send;
	this._method = method;
	this._url = url[0];
	this._query = (url[1] || '') && '?'+url[1];
};

Request.prototype.timeout = function(ms, callback) {
	var self = this;

	if (ms) {
		this._timeout = setTimeout(function() {
			self.destroy();
		}, ms);		
	}

	return this._short(callback);
};
Request.prototype.destroy = noop;
Request.prototype.query = function(query, callback) {
	this._query = querify(query);
	this._query = (this._query && '?') + this._query;
	return this._short(callback);
};
Request.prototype.form = function(data, callback) {
	this._encode = querify;
	return this._short(data, callback);
};
Request.prototype.json = function(json, callback) {
	this._encode = function(data) {
		return JSON.stringify(data);
	};
	this._decode = function(data) {
		return JSON.parse(data);	
	};
	return this._short(json, callback);
};
Request.prototype.bust = function(val, callback) {
	if (typeof val === 'function') {
		callback = val;
		val = true;
	}
	this._bust = val !== false;
	return this._short(callback);	
};
Request.prototype.send = function(data, callback) {
	if (!callback && typeof data !== 'function') {
		callback = noop;
	}
	if (!callback) {
		callback = data;
		data = null;
	} else {
		data = this._encode(data);
	}
	this._addBust();

	var self = this;

	this.destroy = this._send(this._method, this._url+this._query, data, function(err, value) {
		self.destroy = noop;
		
		if (self._timeout) {
			clearTimeout(self._timeout);
		}
		if (err) {
			callback(err);
			return;
		}
		try {
			value = self._decode(value);
		} catch(err) {
			callback(err);
			return;
		}
		callback(null, value);
	});

	return this;
};
Request.prototype._short = function(a,b) {
	return a ? this.send(a,b) : this;
};
Request.prototype._encode = function(data) {
	return ''+data;
};
Request.prototype._decode = function(data) {
	return data;
};
Request.prototype._addBust = function() {
	if (!this._bust) {
		return;
	}
	this._query += (this._query ? '&' : '?') + 't='+(new Date()).getTime();
};

var JSONP = function(url) {
	url = url.split('?');

	this._bust = true;
	this._url = url[0];
	this._query = url.slice(1).join('?') || '';
	this._query = this.query && '?'+this._query;
};

JSONP.prototype.timeout = Request.prototype.timeout; // exactly the same
JSONP.prototype.query = Request.prototype.query; // exactly the same
JSONP.prototype.bust = Request.prototype.bust; // exactly the same

JSONP.prototype.strict = function(callback) {
	this._strict = true;
	return this._short(callback);	
};
JSONP.prototype.async = function(callback) {
	this._async = true;
	return this._short(callback);
};
JSONP.prototype.send = function(method, callback) {
	if (!callback && typeof method !== 'string') {
		callback = method;
		method = 'callback';
	}
	callback = callback || noop;

	this._addBust();

	var self = this;
	var match = this._query.match(/(^|&)([^=])+=\?/);
	var id = 'cb'+prefix+(cnt++).toString(36);
	var callbackId = '_tmp_jsonp.'+id;
	var ended = false;

	if (match) {
		this._query = this._query.replace(match[2]+'=?', match[2]+'='+callbackId);
	} else {
		this._query += (this._query ? '&' : '?') + method+'='+callbackId;
	}

	var url = this._url+this._query;

	var onresult = function(err, result) {
		ended = true;

		var el = document.getElementById(id);
		
		if (el) {
			el.onreadystatechange = el.onclick = noop;
			el.parentNode.removeChild(el);
		}
		el = null; // no mem leaks

		delete globalScope[id];
		self.destroy = noop;

		callback(err, result);
	};

	globalScope[id] = function(result) {
		if (self._strict && (result === undefined || result === null || result.error)) {
			var err = new Error((result && result.error) || 'result is undefined or null');
			
			if (result) {
				for (var i in result) {
					err[i] = result[i];
				}
			}
			onresult(err);
			return;
		}
		onresult(null, result);		
	};

	var attachErrorHandling = function() {
		if (!document.getElementById(id)) {
			return; // safety
		}
		document.getElementById(id).onreadystatechange = function() {
			if (ended || (this.readyState !== 'loaded' && this.readyState !== 'complete')) {
				return;
			}
			onresult(new Error('jsonp request failed'));								
		};		
	};

	if (document.body || this._async) {
		onbody(function() {
			var el = document.createElement('script');

			el.async = true;
			el.src = url;
			el.id = id;

			document.getElementsByTagName('head')[0].appendChild(el);
			
			el = null; // no leaks
			attachErrorHandling();
		});
	} else {
		document.write(unescape('%3Cscript')+' src="'+url+'" id="'+id+'"'+unescape('%3E%3C/script%3E'));
		attachErrorHandling();
	}
	
	this.destroy = function() {
		this.destroy = noop;

		onresult(new Error('jsonp request was cancelled'));
		globalScope[id] = noop;

		setTimeout(function() { 
			delete globalScope[id]; // we lazy collect the noop after 2 mins to allow the server to respond without an error
		}, 2*60*1000);
	};

	return this;
};
JSONP.prototype.destroy = noop;

JSONP.prototype._short = Request.prototype._short; // exactly the same
JSONP.prototype._addBust = Request.prototype._addBust; // exactly the same


var methods = {'POST':0, 'GET':0, 'DELETE':'del', 'PUT':0};

var define = function(method, sender) {
	return function(url, callback) {
		var req = new Request(method, url, sender || send);

		if (callback) {
			req.send(callback);
		}

		return req;
	};
};
var defineTo = function(that, type, send) {
	for (var method in methods) {
		that[(methods[method] || method).toLowerCase()] = define(method, send);
	}
	that['delete'] = that.del;

	that.type = type;
	that.cors = exports.cors;
	that.jsonp = exports.jsonp;

	return that;
};

var baddie = window.navigator.userAgent.match(/msie (\d+)/i);

baddie = baddie && baddie[1] && parseInt(baddie[1]);

var corsable = ('withCredentials' in new XMLHttpRequest());
var proxyable = !!window.postMessage && (!baddie || baddie > 7);

exports.jsonp = function(url, callback) {
	var req = new JSONP(url);

	if (callback) {
		req.send(callback);
	}
	return req;
};
exports.cors = function(options) {
	var ping;
	var proxyHost;

	if (typeof options === 'string') {
		proxyHost = options;
	} else {
		proxyHost = options.host+options.proxy;
		ping = options.ping && (options.host+ (typeof options.ping === 'string' ? options.ping : options.proxy));
	}

	if (corsable) {
		var deferred = createDeferred();
		var host = hostify(proxyHost);

		var oncors = function(method, path, data, callback) {
			return send(method, host+path, data, callback);
		};

		if (ping) {
			send('GET', ping, null, function(err, data) {
				deferred.ready(err ? proxy(proxyHost) : oncors);
			});
		} else {
			deferred.ready(oncors);
		}

		return defineTo({}, 'cors', deferred.send);
	}
	if (proxyable) {
		return defineTo({}, 'proxy', proxy(proxyHost));
	}
	return null;
};

defineTo(exports, 'ajax', send);