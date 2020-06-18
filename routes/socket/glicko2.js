const win = 1;
const draw = 0.5;
const loss = 0;

const mu = 1600;
const phi = 350;
const sigma = 0.06;
const tau = 0.5;
const epsilon = 0.000001;

const ratio = 173.7178;

function Rating(_mu, _phi, _sigma) {
	this._mu = _mu;
	this._phi = _phi;
	this._sigma = _sigma;
}

function Glicko2(_tau) {
	this._mu = mu;
	this._phi = phi;
	this._sigma = sigma;
	this._tau = _tau || tau;
	this._epsilon = epsilon;

	this._ratio = ratio;
}

Glicko2.prototype.createRating = function(__mu, __phi, __sigma) {
	__mu = typeof __mu === 'number' ? __mu : this._mu;
	__phi = typeof __phi === 'number' ? __phi : this._phi;
	__sigma = typeof __sigma === 'number' ? __sigma : this._sigma;

	return new Rating(__mu, __phi, __sigma);
};

Glicko2.prototype.scaleDown = function(rating) {
	const __mu = (rating._mu - this._mu) / this._ratio;
	const __phi = rating._phi / this._ratio;
	const __sigma = rating._sigma;

	return this.createRating(__mu, __phi, __sigma);
};

Glicko2.prototype.scaleUp = function(rating) {
	const __mu = rating._mu * this._ratio + this._mu;
	const __phi = rating._phi * this._ratio;
	const __sigma = rating._sigma;

	return this.createRating(__mu, __phi, __sigma);
};

Glicko2.prototype.reduceImpact = function(rating) {
	return 1 / Math.sqrt(1 + (3 * Math.pow(rating._phi, 2)) / Math.pow(Math.PI, 2));
};

Glicko2.prototype.expectScore = function(ratings, impact) {
	const diff = ratings[0]._mu - ratings[1]._mu;

	return 1 / (1 + Math.exp(-impact * diff));
};

Glicko2.prototype.determineSigma = function(rating, diff, variance) {
	const __tau = this._tau;
	const __phi = rating._phi;
	const __sigma = rating._sigma;
	const __diff = Math.pow(diff, 2);

	const alpha = Math.log(Math.pow(__sigma, 2));

	function f(x) {
		const tmp = Math.pow(__phi, 2) + Math.exp(x) + variance;
		const _a = (Math.exp(x) * (__diff - tmp)) / (2 * Math.pow(tmp, 2));
		const _b = (x - alpha) / Math.pow(__tau, 2);

		return _a - _b;
	}

	let a = alpha;
	let b = 0;

	if (__diff > Math.pow(__phi, 2) + variance) {
		b = Math.log(__diff - Math.pow(__phi, 2) - variance);
	} else {
		let k = 1;
		while (f(alpha - k * __tau) < 0) {
			k += 1;
		}

		b = alpha - k * __tau;
	}

	let f_a = f(a);
	let f_b = f(b);

	while (Math.abs(b - a) > this._epsilon) {
		const c = a + ((a - b) * f_a) / (f_b - f_a);
		const f_c = f(c);

		if (f_c * f_b < 0) {
			a = b;
			f_a = f_b;
		} else {
			f_a = f_a / 2;
		}

		b = c;
		f_b = f_c;
	}

	return Math.pow(Math.exp(1), a / 2);
};

Glicko2.prototype.ratePlayer = function(rating, series) {
	rating = this.scaleDown(rating);

	let varianceInv = 0;
	let difference = 0;

	if (series === undefined) {
		const phiStar = Math.sqrt(Math.pow(rating._phi, 2) + Math.pow(rating._sigma, 2));

		const output = this.createRating(rating._mu, phiStar, rating._sigma);
		return this.scaleUp(output);
	}

	series.forEach(m => {
		const score = m[0];
		let adversary = m[1];
		adversary = this.scaleDown(adversary);

		const impact = this.reduceImpact(adversary);
		const expectation = this.expectScore([rating, adversary], impact);

		varianceInv += Math.pow(impact, 2) * expectation * (1 - expectation);
		difference += impact * (score - expectation);
	});

	difference = difference / varianceInv;
	const variance = 1 / varianceInv;

	const sigma = this.determineSigma(rating, difference, variance);

	const phiStar = Math.sqrt(Math.pow(rating._phi, 2) + Math.pow(sigma, 2));
	const phi = 1 / Math.sqrt(1 / Math.pow(phiStar, 2) + 1 / variance);

	const mu = rating._mu + (Math.pow(phi, 2) * difference) / variance;

	const output = this.createRating(mu, phi, sigma);
	return this.scaleUp(output);
};

Glicko2.prototype.rate1vs1 = function(rating, adversary, drawn) {
	return [this.ratePlayer(rating, [[drawn ? draw : win, adversary]]), this.ratePlayer(adversary, [[drawn ? draw : loss, rating]])];
};

Glicko2.prototype.rateByTeamComposite = function(teams) {
	function avg(array) {
		return array.reduce((acc, cur) => acc + cur) / array.length;
	}

	output = [];
	composites = [];

	teams.forEach(t => {
		let __mu = t.map(r => r._mu);
		let __phi = t.map(r => r._phi);

		__mu = avg(__mu);
		__phi = avg(__phi);

		const c = this.createRating(__mu, __phi);

		composites.push(c);
	});

	teams.forEach((t_a, i_a) => {
		teams.forEach((t_b, i_b) => {
			if (i_a === i_b) return;

			t_a.forEach(r => {
				const a = composites[i_b];
				const e = i_a < i_b ? win : loss;

				o = this.ratePlayer(r, [[e, a]]);

				output.push(o);
			});
		});
	});

	return output;
};

module.exports.Glicko2 = Glicko2;
