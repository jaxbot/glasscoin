var http = require('http');
var url = require("url");
var fs = require('fs');

var googleapis = require('googleapis');
var OAuth2Client = googleapis.OAuth2Client;

var config = require("./config.json");

var oauth2Client = new OAuth2Client(config.client_id, config.client_secret, config.redirect_url);

var apiclient = null;

var user_card_ids = {};

var client_tokens = [];

try {
	var filedata = fs.readFileSync(".clienttokens.json");
	if (filedata) {
		client_tokens = JSON.parse(filedata.toString());
	}
} catch(e) {
	console.log("Info: failed to load .clienttokens.json, using blank array");
}

googleapis.discover('mirror','v1').execute(function(err,client) {
	if (err) {
		console.warn("ERR: " + err.toString());
		return;
	}
	apiclient = client;

	for(var i = 0; i < client_tokens.length; i++) {
		updatePinnedItemsList(client_tokens[i].access_token);
	}

	http.createServer(httpHandler).listen(8099);
});
	
function httpHandler(req,res) {
	var u = url.parse(req.url, true)
	var s = u.pathname.split("/");

	if (s[1] == "oauth2callback") {
		oauth2Client.getToken(u.query.code, function(err,tokens) {
			if (err) {
				console.log(err);
			} else {
				client_tokens.push(tokens);
				saveTokens();
				updatePinnedItemsList(tokens.access_token);
			}
			res.write('');
			res.end();
		});
		return;
	}
	
	if (!oauth2Client.credentials) {
		var uri = oauth2Client.generateAuthUrl({
			access_type: 'offline',
			scope: 'https://www.googleapis.com/auth/glass.timeline'
		});
		res.writeHead(301, { "Location": uri });
		res.end();
	} else {
		if (s[1] == "timeline") {
			getMarketData();
		}
		res.write('Glass Mirror API with Node');
		res.end();
	}
};

function getMarketData() {
	http.get("http://api.bitcoinaverage.com/ticker/global/USD/", function(res) {
		var data = "";
		res.on('data', function(chunk) {
			data += chunk;
		});
		res.on('end', function() {
			var market = JSON.parse(data.toString());
			var btclast = market.last;
			var btcdelta = 100 * (market.last - market["24h_avg"]) / market["24h_avg"];

			updateCards(btclast, btcdelta.toPrecision(3), market["24h_avg"], market.timestamp);
		});
	});
	updateCards();
}

function updateCards(btclast, btcdelta, avg, time) {
	var html = "<article>\n  <section>\n    <img src='http://www.idimmu.net/wp-content/uploads/2013/03/bitcoin.png' width=200 height=200 style='float:left;margin-right:20px'>\n<p>Bitcoin</p>\n<span class='text-large'>$" + btclast + " <span class='" + ((btcdelta < 0) ? 'red' : 'green') + "'>" + btcdelta + "%</span></span>\n<p>$" + avg + " (24h)\n  </section>\n<footer>" + time + "</footer>\n</article>";

	for (i = 0; i < client_tokens.length; i++) {
		var apiCall;
		if (id = user_card_ids[client_tokens[i].access_token]) {
			apiCall = apiclient.mirror.timeline.patch({"id": id }, {"html": html});
		}
		else
			apiCall = apiclient.mirror.timeline.insert({
				"html": html,
				"menuItems": [
					{"action":"TOGGLE_PINNED"},
					{"action":"DELETE"}
				],
				"sourceItemId": "glasscoin"
			});

		oauth2Client.credentials = client_tokens[i];
		console.log(client_tokens[i]);

		(function(i) {
			apiCall.withAuthClient(oauth2Client).execute(function(err,data) {
				console.log(err);
				console.log(data);
				if (!user_card_ids[client_tokens[i].access_token])
					user_card_ids[client_tokens[i].access_token] = data.id;
			})
		})(i);
	}
}

// update every 15
setInterval(getMarketData, 60 * 1000 * 15);

function saveTokens() {
	fs.writeFileSync(".clienttokens.json", JSON.stringify(client_tokens,null,5));
}

function updatePinnedItemsList(access_token) {
	for (var i = 0; i < client_tokens.length; i++) {
		if (client_tokens[i].access_token == access_token) {
			oauth2Client.credentials = client_tokens[i];
		}
	}

	apiclient.mirror.timeline.list({ "sourceItemId": "glasscoin" })
		.withAuthClient(oauth2Client)
		.execute(function(err,data) {
			console.log(data);
			if (data.items.length > 0) {
				user_card_ids[access_token] = data.items[0].id;
			}
			getMarketData();
	});
}

