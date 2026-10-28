// A flat C interface to RocketSim for JavaScript (Emscripten). States move as arrays of doubles in
// RocketSim's own frame and units (uu); the JS side mirrors them into the game's frame.
#include "RocketSim.h"
#include <emscripten/emscripten.h>
#include <map>
#include <vector>

using namespace RocketSim;

static Arena* arena = nullptr;
static std::map<int, Car*> cars;
static std::vector<double> events; // (hitter id, victim id, demo 0/1) per bump

static void onBump(Arena*, Car* bumper, Car* victim, bool isDemo, void*) {
	events.push_back(bumper->id);
	events.push_back(victim->id);
	events.push_back(isDemo ? 1 : 0);
}

static void putVec(double*& o, const Vec& v) { *o++ = v.x; *o++ = v.y; *o++ = v.z; }
static Vec getVec(const double*& i) { Vec v; v.x = (float)i[0]; v.y = (float)i[1]; v.z = (float)i[2]; i += 3; return v; }
static double tickOut(uint64_t t) { return t == ~0ULL ? -1.0 : (double)t; }
static uint64_t tickIn(double t) { return t < 0 ? ~0ULL : (uint64_t)t; }

extern "C" {

// mesh files packed as [int32 length][bytes]... count times
EMSCRIPTEN_KEEPALIVE int rs_init(const uint8_t* data, int count) {
	std::map<GameMode, std::vector<FileData>> files;
	const uint8_t* p = data;
	for (int k = 0; k < count; k++) {
		int32_t n;
		memcpy(&n, p, 4);
		p += 4;
		files[GameMode::SOCCAR].push_back(FileData(p, p + n));
		p += n;
	}
	RocketSim::InitFromMem(files, true);
	return (int)RocketSim::GetArenaCollisionShapes(GameMode::SOCCAR).size();
}

EMSCRIPTEN_KEEPALIVE void rs_create() {
	if (arena) delete arena;
	cars.clear();
	arena = Arena::Create(GameMode::SOCCAR);
	arena->SetCarBumpCallback(onBump, nullptr);
}

EMSCRIPTEN_KEEPALIVE int rs_add_car(int team) {
	Car* c = arena->AddCar(team ? Team::ORANGE : Team::BLUE, CAR_CONFIG_OCTANE);
	cars[(int)c->id] = c;
	return (int)c->id;
}

EMSCRIPTEN_KEEPALIVE void rs_clear_cars() {
	for (auto& kv : cars) arena->RemoveCar(kv.second);
	cars.clear();
}

EMSCRIPTEN_KEEPALIVE void rs_controls(int id, float th, float st, float pi, float ya, float ro, int j, int b, int h) {
	Car* c = cars[id];
	if (!c) return;
	c->controls.throttle = th;
	c->controls.steer = st;
	c->controls.pitch = pi;
	c->controls.yaw = ya;
	c->controls.roll = ro;
	c->controls.jump = j != 0;
	c->controls.boost = b != 0;
	c->controls.handbrake = h != 0;
}

EMSCRIPTEN_KEEPALIVE void rs_step(int n) { arena->Step(n); }

EMSCRIPTEN_KEEPALIVE double rs_tick() { return (double)arena->tickCount; }
EMSCRIPTEN_KEEPALIVE void rs_set_tick(double t) { arena->tickCount = (uint64_t)t; }

// 73 doubles, see the JS side for the layout
EMSCRIPTEN_KEEPALIVE void rs_get_car(int id, double* out) {
	Car* c = cars[id];
	if (!c) return;
	CarState s = c->GetState();
	double* o = out;
	putVec(o, s.pos); putVec(o, s.vel); putVec(o, s.angVel);
	putVec(o, s.rotMat.forward); putVec(o, s.rotMat.right); putVec(o, s.rotMat.up);
	*o++ = s.isOnGround;
	for (int k = 0; k < 4; k++) *o++ = s.wheelsWithContact[k];
	*o++ = s.hasJumped; *o++ = s.hasDoubleJumped; *o++ = s.hasFlipped;
	putVec(o, s.flipRelTorque);
	*o++ = s.jumpTime; *o++ = s.flipTime; *o++ = s.isFlipping; *o++ = s.isJumping;
	*o++ = s.airTime; *o++ = s.airTimeSinceJump; *o++ = s.boost; *o++ = s.timeSinceBoosted;
	*o++ = s.isBoosting; *o++ = s.boostingTime; *o++ = s.isSupersonic; *o++ = s.supersonicTime;
	*o++ = s.handbrakeVal; *o++ = s.isAutoFlipping; *o++ = s.autoFlipTimer; *o++ = s.autoFlipTorqueScale;
	*o++ = s.worldContact.hasContact; putVec(o, s.worldContact.contactNormal);
	*o++ = s.carContact.otherCarID; *o++ = s.carContact.cooldownTimer;
	*o++ = s.isDemoed; *o++ = s.demoRespawnTimer;
	*o++ = s.ballHitInfo.isValid; putVec(o, s.ballHitInfo.relativePosOnBall); putVec(o, s.ballHitInfo.ballPos); putVec(o, s.ballHitInfo.extraHitVel);
	*o++ = tickOut(s.ballHitInfo.tickCountWhenHit); *o++ = tickOut(s.ballHitInfo.tickCountWhenExtraImpulseApplied);
	const CarControls& l = s.lastControls;
	*o++ = l.throttle; *o++ = l.steer; *o++ = l.pitch; *o++ = l.yaw; *o++ = l.roll; *o++ = l.jump; *o++ = l.boost; *o++ = l.handbrake;
}

EMSCRIPTEN_KEEPALIVE void rs_set_car(int id, const double* in) {
	Car* c = cars[id];
	if (!c) return;
	CarState s = c->GetState();
	const double* i = in;
	s.pos = getVec(i); s.vel = getVec(i); s.angVel = getVec(i);
	s.rotMat.forward = getVec(i); s.rotMat.right = getVec(i); s.rotMat.up = getVec(i);
	s.isOnGround = *i++ != 0;
	for (int k = 0; k < 4; k++) s.wheelsWithContact[k] = *i++ != 0;
	s.hasJumped = *i++ != 0; s.hasDoubleJumped = *i++ != 0; s.hasFlipped = *i++ != 0;
	s.flipRelTorque = getVec(i);
	s.jumpTime = (float)*i++; s.flipTime = (float)*i++; s.isFlipping = *i++ != 0; s.isJumping = *i++ != 0;
	s.airTime = (float)*i++; s.airTimeSinceJump = (float)*i++; s.boost = (float)*i++; s.timeSinceBoosted = (float)*i++;
	s.isBoosting = *i++ != 0; s.boostingTime = (float)*i++; s.isSupersonic = *i++ != 0; s.supersonicTime = (float)*i++;
	s.handbrakeVal = (float)*i++; s.isAutoFlipping = *i++ != 0; s.autoFlipTimer = (float)*i++; s.autoFlipTorqueScale = (float)*i++;
	s.worldContact.hasContact = *i++ != 0; s.worldContact.contactNormal = getVec(i);
	s.carContact.otherCarID = (uint32_t)*i++; s.carContact.cooldownTimer = (float)*i++;
	s.isDemoed = *i++ != 0; s.demoRespawnTimer = (float)*i++;
	s.ballHitInfo.isValid = *i++ != 0; s.ballHitInfo.relativePosOnBall = getVec(i); s.ballHitInfo.ballPos = getVec(i); s.ballHitInfo.extraHitVel = getVec(i);
	s.ballHitInfo.tickCountWhenHit = tickIn(*i++); s.ballHitInfo.tickCountWhenExtraImpulseApplied = tickIn(*i++);
	CarControls& l = s.lastControls;
	l.throttle = (float)*i++; l.steer = (float)*i++; l.pitch = (float)*i++; l.yaw = (float)*i++; l.roll = (float)*i++;
	l.jump = *i++ != 0; l.boost = *i++ != 0; l.handbrake = *i++ != 0;
	c->SetState(s);
}

// 18 doubles: pos, vel, angVel, rot (forward, right, up)
EMSCRIPTEN_KEEPALIVE void rs_get_ball(double* out) {
	BallState s = arena->ball->GetState();
	double* o = out;
	putVec(o, s.pos); putVec(o, s.vel); putVec(o, s.angVel);
	putVec(o, s.rotMat.forward); putVec(o, s.rotMat.right); putVec(o, s.rotMat.up);
}

EMSCRIPTEN_KEEPALIVE void rs_set_ball(const double* in) {
	BallState s = arena->ball->GetState();
	const double* i = in;
	s.pos = getVec(i); s.vel = getVec(i); s.angVel = getVec(i);
	s.rotMat.forward = getVec(i); s.rotMat.right = getVec(i); s.rotMat.up = getVec(i);
	arena->ball->SetState(s);
	// (a resting ball goes to sleep in Bullet; a moved one must wake)
	arena->ball->_rigidBody.activate(true);
}

EMSCRIPTEN_KEEPALIVE int rs_pad_count() { return (int)arena->GetBoostPads().size(); }

// x, y, z, big
EMSCRIPTEN_KEEPALIVE void rs_pad_info(int k, double* out) {
	BoostPad* p = arena->GetBoostPads()[k];
	out[0] = p->config.pos.x; out[1] = p->config.pos.y; out[2] = p->config.pos.z; out[3] = p->config.isBig;
}

// per pad: active, cooldown, previous locked car
EMSCRIPTEN_KEEPALIVE void rs_get_pads(double* out) {
	auto& pads = arena->GetBoostPads();
	for (size_t k = 0; k < pads.size(); k++) {
		BoostPadState s = pads[k]->GetState();
		out[k * 3] = s.isActive; out[k * 3 + 1] = s.cooldown; out[k * 3 + 2] = s.prevLockedCarID;
	}
}

EMSCRIPTEN_KEEPALIVE void rs_set_pads(const double* in) {
	auto& pads = arena->GetBoostPads();
	for (size_t k = 0; k < pads.size(); k++) {
		BoostPadState s;
		s.isActive = in[k * 3] != 0; s.cooldown = (float)in[k * 3 + 1]; s.prevLockedCarID = (uint32_t)in[k * 3 + 2]; s.curLockedCar = nullptr;
		pads[k]->SetState(s);
	}
}

// bumps since the last call: (hitter, victim, demo) triples; returns how many doubles were written
EMSCRIPTEN_KEEPALIVE int rs_events(double* out, int max) {
	int n = (int)events.size() < max ? (int)events.size() : max;
	for (int k = 0; k < n; k++) out[k] = events[k];
	events.clear();
	return n;
}

EMSCRIPTEN_KEEPALIVE void* rs_malloc(int n) { return malloc(n); }
EMSCRIPTEN_KEEPALIVE void rs_free(void* p) { free(p); }

}
