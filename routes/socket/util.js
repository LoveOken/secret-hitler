const { Glicko2 } = require('./glicko2');

/**
 * @param {object} game - game to act on.
 * @return {object} game
 */
const secureGame = game => {
	const _game = Object.assign({}, game);

	delete _game.private;
	delete _game.remakeData;
	return _game;
};

const combineInProgressChats = (game, userName) =>
	userName && game.gameState.isTracksFlipped
		? game.private.seatedPlayers.find(player => player.userName === userName).gameChats.concat(game.chats)
		: game.private.unSeatedGameChats.concat(game.chats);

/**
 * @param {object} game - game to act on.
 * @param {boolean} noChats - remove chats for client to handle.
 */
module.exports.sendInProgressGameUpdate = (game, noChats) => {
	if (!game || !io.sockets.adapter.rooms[game.general.uid]) {
		return;
	}

	// DEBUG ONLY
	// console.log(game.general.status, 'TimedMode:', game.gameState.timedModeEnabled, 'TimerId:', game.private.timerId ? 'exists' : 'null');

	const seatedPlayerNames = game.publicPlayersState.map(player => player.userName);
	const roomSockets = Object.keys(io.sockets.adapter.rooms[game.general.uid].sockets).map(sockedId => io.sockets.connected[sockedId]);
	const playerSockets = roomSockets.filter(
		socket =>
			socket &&
			socket.handshake.session.passport &&
			Object.keys(socket.handshake.session.passport).length &&
			seatedPlayerNames.includes(socket.handshake.session.passport.user)
	);
	const observerSockets = roomSockets.filter(
		socket => (socket && !socket.handshake.session.passport) || (socket && !seatedPlayerNames.includes(socket.handshake.session.passport.user))
	);

	playerSockets.forEach(sock => {
		const _game = Object.assign({}, game);
		const { user } = sock.handshake.session.passport;

		if (!game.gameState.isCompleted && game.gameState.isTracksFlipped) {
			const privatePlayer = _game.private.seatedPlayers.find(player => user === player.userName);

			if (!_game || !privatePlayer) {
				return;
			}

			_game.playersState = privatePlayer.playersState;
			_game.cardFlingerState = privatePlayer.cardFlingerState || [];
		}

		if (noChats) {
			delete _game.chats;
			sock.emit('gameUpdate', secureGame(_game), true);
		} else {
			_game.chats = combineInProgressChats(_game, user);
			sock.emit('gameUpdate', secureGame(_game));
		}
	});

	let chatWithHidden = game.chats;
	if (!noChats && game.private && game.private.hiddenInfoChat && game.private.hiddenInfoSubscriptions.length) {
		chatWithHidden = [...chatWithHidden, ...game.private.hiddenInfoChat];
	}
	if (observerSockets.length) {
		observerSockets.forEach(sock => {
			const _game = Object.assign({}, game);
			const user = sock.handshake.session.passport ? sock.handshake.session.passport.user : null;

			if (noChats) {
				delete _game.chats;
				sock.emit('gameUpdate', secureGame(_game), true);
			} else if (user && game.private && game.private.hiddenInfoSubscriptions && game.private.hiddenInfoSubscriptions.includes(user)) {
				// AEM status is ensured when adding to the subscription list
				_game.chats = chatWithHidden;
				_game.chats = combineInProgressChats(_game);
				sock.emit('gameUpdate', secureGame(_game));
			} else {
				_game.chats = combineInProgressChats(_game);
				sock.emit('gameUpdate', secureGame(_game));
			}
		});
	}
};

module.exports.sendInProgressModChatUpdate = (game, chat, specificUser) => {
	if (!io.sockets.adapter.rooms[game.general.uid]) {
		return;
	}

	const roomSockets = Object.keys(io.sockets.adapter.rooms[game.general.uid].sockets).map(sockedId => io.sockets.connected[sockedId]);

	if (roomSockets.length) {
		roomSockets.forEach(sock => {
			if (sock && sock.handshake && sock.handshake.passport && sock.handshake.passport.user) {
				const { user } = sock.handshake.session.passport;
				if (game.private.hiddenInfoSubscriptions.includes(user)) {
					// AEM status is ensured when adding to the subscription list
					if (!specificUser) {
						// single message
						sock.emit('gameModChat', chat);
					} else if (specificUser === user) {
						// list of messages
						chat.forEach(msg => sock.emit('gameModChat', msg));
					}
				}
			}
		});
	}
};

module.exports.sendPlayerChatUpdate = (game, chat) => {
	if (!io.sockets.adapter.rooms[game.general.uid]) {
		return;
	}

	const roomSockets = Object.keys(io.sockets.adapter.rooms[game.general.uid].sockets).map(sockedId => io.sockets.connected[sockedId]);

	roomSockets.forEach(sock => {
		if (sock) {
			sock.emit('playerChatUpdate', chat);
		}
	});
};

module.exports.secureGame = secureGame;

const avg = (accounts, accessor) => accounts.reduce((prev, curr) => prev + accessor(curr), 0) / accounts.length;

module.exports.rateEloGame = (game, accounts, winningPlayerNames) => {
	// ELO constants
	const defaultELO = 1600;
	const libAdjust = {
		5: -19.253,
		6: 20.637,
		7: -17.282,
		8: 45.418,
		9: -70.679,
		10: -31.539
	};
	const rk = 9;
	const nk = 4;
	// Players
	const losingPlayerNames = game.private.seatedPlayers.filter(player => !winningPlayerNames.includes(player.userName)).map(player => player.userName);
	// Accounts
	const winningAccounts = accounts.filter(account => winningPlayerNames.includes(account.username));
	const loosingAccounts = accounts.filter(account => losingPlayerNames.includes(account.username));
	// Construct some basic statistics for each team
	const b = game.gameState.isCompleted === 'liberal' ? 1 : 0;
	const size = game.private.seatedPlayers.length;
	const averageRatingWinners = avg(winningAccounts, a => a.eloOverall || defaultELO) + b * libAdjust[size];
	const averageRatingWinnersSeason = avg(winningAccounts, a => a.eloSeason || defaultELO) + b * libAdjust[size];
	const averageRatingLosers = avg(loosingAccounts, a => a.eloOverall || defaultELO) + (1 - b) * libAdjust[size];
	const averageRatingLosersSeason = avg(loosingAccounts, a => a.eloSeason || defaultELO) + (1 - b) * libAdjust[size];
	// Elo Formula
	const k = size * (game.general.rainbowgame ? rk : nk); // non-rainbow games are capped at k/r
	const winFactor = k / winningPlayerNames.length;
	const loseFactor = -k / losingPlayerNames.length;
	const p = 1 / (1 + Math.pow(10, (averageRatingWinners - averageRatingLosers) / 400));
	const pSeason = 1 / (1 + Math.pow(10, (averageRatingWinnersSeason - averageRatingLosersSeason) / 400));
	const ratingUpdates = {};
	accounts.forEach(account => {
		const eloOverall = account.eloOverall ? account.eloOverall : defaultELO;
		const eloSeason = account.eloSeason ? account.eloSeason : defaultELO;
		const factor = winningPlayerNames.includes(account.username) ? winFactor : loseFactor;
		const change = p * factor;
		const changeSeason = pSeason * factor;
		account.eloOverall = eloOverall + change;
		account.eloSeason = eloSeason + changeSeason;
		account.save();
		ratingUpdates[account.username] = { change, changeSeason };
	});
	return ratingUpdates;
};

module.exports.rateGlickoGame = (game, accounts, winningPlayerNames) => {
	// Glicko constants
	const g2 = new Glicko2();
	// Players
	const losingPlayerNames = game.private.seatedPlayers.filter(player => !winningPlayerNames.includes(player.userName)).map(player => player.userName);
	// Accounts
	const winningAccounts = accounts.filter(account => winningPlayerNames.includes(account.username));
	const loosingAccounts = accounts.filter(account => losingPlayerNames.includes(account.username));
	// Create Glicko2 Ratings
	let x = true;
	const datesToMinuteDiff = (date1, date2) => {
		const diff = date1 - date2;
		return Math.round(diff / 1000 / 60);
	};
	const mapGlicko = account => {
		const holder = x ? account.glickoOverall : account.glickoSeason;
		const gray = g2.createRating(holder.rating, 35, 0.06);
		let rainbow = holder.rd ? g2.createRating(holder.rating, holder.rd, holder.vol) : g2.createRating();

		// Rating decay
		const time = datesToMinuteDiff(new Date(), account.lastCompletedGame || new Date());
		rainbow = g2.decayRD(rainbow, Math.floor(time / 20160)); // For each 2 weeks decay RD

		return game.general.rainbowgame ? rainbow : gray;
	};
	const ratingOverall = [winningAccounts.map(mapGlicko), loosingAccounts.map(mapGlicko)];
	x = false;
	const ratingSeason = [winningAccounts.map(mapGlicko), loosingAccounts.map(mapGlicko)];
	// Modify ratings
	const newOverallRatings = g2.rateByTeamComposite(ratingOverall);
	const newSeasonRatings = g2.rateByTeamComposite(ratingSeason);
	// Update ratings
	const updateGlicko = (updated, index, results) => {
		const account = results[i];
		const outdated = !x ? account.glickoOverall : account.glickoSeason;

		if (!x) account.glickoRatingHistory.push(outdated.rating || 1600);

		outdated.rating = updated._mu;
		if (game.general.rainbowgame) {
			outdated.rd = updated._phi;
			outdated.vol = updated._sigma;
		}

		console.log(account.username, outdated);
	};
	console.log('Updating Overall');
	newOverallRatings[0].forEach((u, i) => updateGlicko(u, i, winningAccounts));
	newOverallRatings[1].forEach((u, i) => updateGlicko(u, i, loosingAccounts));
	x = true;
	console.log('Updating Seasonal');
	newSeasonRatings[0].forEach((u, i) => updateGlicko(u, i, winningAccounts));
	newSeasonRatings[1].forEach((u, i) => updateGlicko(u, i, loosingAccounts));
};

module.exports.destroySession = username => {
	if (process.env.NODE_ENV !== 'production') {
		const Mongoclient = require('mongodb').MongoClient;

		let mongoClient;

		Mongoclient.connect('mongodb://localhost:27017', { useNewUrlParser: true }, (err, client) => {
			mongoClient = client;
		});

		if (!mongoClient) {
			console.log('WARN: No mongo connection, cannot destroy user session.');
			return;
		}
		mongoClient
			.db('secret-hitler-app')
			.collection('sessions')
			.findOneAndDelete({ 'session.passport.user': username }, err => {
				if (err) {
					try {
						console.log(err, 'err in logoutuser');
					} catch (error) {}
				}
			});
	}
};
