"""Self-check for docs/research/01-stances.md.

Re-derives every geometric claim in the spec from the anthropometric constants and
asserts the published numbers are internally consistent. Run:  python _verify_01_stances.py
Exit code 0 = spec is self-consistent.
"""
import math, sys

# --- anthropometrics (spec section 1) ---
ANKLE_Y, KNEE_Y = 0.039, 0.285
THIGH, SHANK = 0.245, 0.246
LEG_EXT = THIGH + SHANK
HIP_Y_STAND = 0.530
HIP_JOINT_SEP = 0.098
SHOULDER_W = 0.259
MTP_AHEAD, TOE_AHEAD, HEEL_BEHIND = 0.070, 0.100, 0.052
H_CM = 175.0

FAILS = []
def chk(name, got, want, tol):
    ok = abs(got - want) <= tol
    print(f"{'PASS' if ok else 'FAIL'}  {name:52s} got={got:9.4f} want={want:9.4f} tol={tol}")
    if not ok:
        FAILS.append(name)

def leg_len(flex_deg):
    return math.sqrt(THIGH**2 + SHANK**2 + 2*THIGH*SHANK*math.cos(math.radians(flex_deg)))

def knee_flex(L):
    L = min(L, LEG_EXT - 1e-9)
    c = (L*L - THIGH**2 - SHANK**2) / (2*THIGH*SHANK)
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))

def knee_pos(ankle, hip, fwd=-1):
    ax, ay = ankle; hx, hy = hip
    d = math.hypot(hx-ax, hy-ay)
    a = (SHANK**2 - THIGH**2 + d*d) / (2*d)
    h = math.sqrt(max(SHANK**2 - a*a, 0.0))
    mx, my = ax + a*(hx-ax)/d, ay + a*(hy-ay)/d
    ox, oy = -(hy-ay)/d*h, (hx-ax)/d*h
    s1, s2 = (mx+ox, my+oy), (mx-ox, my-oy)
    return s1 if (s1[0]-mx)*fwd >= 0 else s2

PY = 0.410                     # FIGHT_PELVIS_Y
V = PY - ANKLE_Y

print("=== segment-length internal consistency ===")
chk("KNEE_Y == ANKLE_Y + SHANK", ANKLE_Y + SHANK, KNEE_Y, 0.001)
chk("HIP_Y_STAND == KNEE_Y + THIGH", KNEE_Y + THIGH, HIP_Y_STAND, 0.001)
chk("FIGHT drop", HIP_Y_STAND - PY, 0.120, 0.0005)
chk("FIGHT drop cm", (HIP_Y_STAND - PY) * H_CM, 21.0, 0.1)
chk("eye Y fighting", PY + (0.936 - 0.530), 0.816, 0.001)

print("\n=== ZENKUTSU (S=0.540, rear flex 10) ===")
S = 0.540
rear_reach = math.sqrt(leg_len(10)**2 - V*V)
front_setback = S - rear_reach
chk("hip Z ahead of rear ankle", rear_reach, 0.319, 0.002)
chk("hip Z behind front ankle", front_setback, 0.221, 0.002)
chk("front load %", (1 - front_setback/S)*100, 59.0, 0.5)
Lf = math.hypot(front_setback, V)
chk("front knee flexion", knee_flex(Lf), 57.0, 1.0)
k = knee_pos((0.0, ANKLE_Y), (front_setback, PY))
# local u axis points BACKWARD, world Z also points backward -> k[0] == knee.Z - ankle.Z
chk("front knee Z - ankle Z (+ = behind)", k[0], +0.011, 0.002)
chk("front knee Y", k[1], 0.284, 0.002)
chk("front shin tilt deg", math.degrees(math.atan2(-k[0], k[1]-ANKLE_Y)), -2.5, 0.5)
chk("S in shoulder widths", S/SHOULDER_W, 2.08, 0.01)
chk("S cm", S*H_CM, 94.5, 0.1)
chk("heel-to-heel along embusen", S - HEEL_BEHIND + HEEL_BEHIND*math.cos(math.radians(30)), 0.533, 0.002)
kr = knee_pos((0.0, ANKLE_Y), (-rear_reach, PY))
chk("rear leg line lean deg", math.degrees(math.atan2(rear_reach, V)), 40.7, 0.3)
chk("rear shank lean deg (DF demand)", math.degrees(math.atan2(abs(kr[0]), kr[1]-ANKLE_Y)), 45.7, 0.4)
chk("rear knee Z ahead of rear ankle", abs(kr[0]), 0.176, 0.003)

print("\n=== ZENKUTSU bounds & the 60/40 vs 70/30 resolution ===")
def zen_row(S_):
    fr = S_ - rear_reach
    kk = knee_pos((0.0, ANKLE_Y), (fr, PY))
    # spec sec 3.6 column is "+ = ahead of the ankle", i.e. -(knee.Z - ankle.Z)
    return (1-fr/S_)*100, knee_flex(math.hypot(fr, V)), -kk[0]*H_CM
for S_, wf, fk, dz in [(0.450,70.8,73.5,+12.7),(0.530,60.1,59.2,-0.1),(0.580,55.0,44.9,-9.5)]:
    a,b,c = zen_row(S_)
    chk(f"S={S_} front load %", a, wf, 0.4)
    chk(f"S={S_} front knee flex", b, fk, 0.6)
    chk(f"S={S_} knee-vs-ankle cm (+ahead)", c, dz, 0.4)
# knee over the ball of the foot forces ~70%
yk = ANKLE_Y + math.sqrt(SHANK**2 - MTP_AHEAD**2)
uh = math.sqrt(THIGH**2 - (PY-yk)**2) - MTP_AHEAD
S_ball = uh + rear_reach
chk("knee-over-ball: S", S_ball, 0.453, 0.003)
chk("knee-over-ball: front load %", (1-uh/S_ball)*100, 70.4, 0.5)
chk("knee-over-ball: front knee flex", knee_flex(math.hypot(uh, V)), 73.0, 0.6)

print("\n=== KOKUTSU (70% rear, front flex 18) ===")
fr_k = math.sqrt(leg_len(18)**2 - V*V)
Sk = fr_k / 0.70
chk("S", Sk, 0.446, 0.003)
chk("S in shoulder widths", Sk/SHOULDER_W, 1.72, 0.02)
chk("S cm", Sk*H_CM, 78.1, 0.5)
chk("hip Z ahead of rear ankle", 0.30*Sk, 0.134, 0.002)
chk("rear knee flexion", knee_flex(math.hypot(0.30*Sk, V)), 73.1, 0.6)
kk = knee_pos((0.0, ANKLE_Y), (fr_k, PY))
chk("front knee Z behind ankle", kk[0], 0.127, 0.003)
chk("front shin tilt back deg", math.degrees(math.atan2(kk[0], kk[1]-ANKLE_Y)), 31.1, 0.6)
chk("heel-to-heel along embusen", Sk - HEEL_BEHIND, 0.394, 0.003)
Smax = math.sqrt(LEG_EXT**2 - V*V)/0.70
chk("S max (straight front leg)", Smax, 0.459, 0.003)
# 2 shoulder widths must be infeasible at fighting height
need = math.hypot(0.70*2*SHOULDER_W, V)
print(f"PASS  {'2sw kokutsu needs front leg':52s} got={need:9.4f} > LEG_EXT={LEG_EXT:.4f}"
      if need > LEG_EXT else "FAIL  2sw kokutsu should be infeasible")
if need <= LEG_EXT: FAILS.append("2sw kokutsu infeasibility")

print("\n=== KIBA (shins vertical) ===")
W = 0.520
lat = (W - HIP_JOINT_SEP)/2
dy = math.sqrt(THIGH**2 - lat**2)
chk("pelvis Y", KNEE_Y + dy, 0.4095, 0.0015)
chk("drop", HIP_Y_STAND - (KNEE_Y+dy), 0.1205, 0.0015)
chk("knee flexion (frontal)", math.degrees(math.atan2(lat, dy)), 59.5, 0.4)
chk("W in shoulder widths", W/SHOULDER_W, 2.01, 0.02)
chk("W cm", W*H_CM, 91.0, 0.2)
chk("equal-height vs zenkutsu (H)", abs((KNEE_Y+dy) - PY), 0.0, 0.012)

print("\n=== MID-STEP ===")
Lm = math.sqrt(0.072**2 + (HIP_JOINT_SEP/2)**2 + V*V)
chk("support knee flexion @ pelvis 0.410", knee_flex(Lm), 78.2, 0.6)
for rise_cm, want in [(1.0, 76.1), (2.0, 74.0), (3.5, 70.7), (6.0, 64.8), (10.0, 54.3)]:
    v2 = PY + rise_cm/H_CM - ANKLE_Y
    L2 = math.sqrt(0.072**2 + (HIP_JOINT_SEP/2)**2 + v2*v2)
    chk(f"support knee flex @ +{rise_cm}cm", knee_flex(L2), want, 0.6)
chk("swing foot travel (2S) cm", 2*S*H_CM, 189.0, 0.5)
# mid-step support-leg pose
km = knee_pos((0.0, ANKLE_Y), (-0.072, PY))
chk("mid-step support knee Z ahead of ankle", abs(km[0]), 0.190, 0.005)
thigh_v = (km[0] + 0.072, km[1] - PY)
chk("mid-step support hip flexion deg",
    math.degrees(math.atan2(abs(thigh_v[0]), -thigh_v[1])), 29.0, 1.0)

print("\n=== HALF STANCES ===")
for label, Sh, py, wf, wr in [("han-zenkutsu", 0.270, 0.410, 74.6, 71.0),
                               ("moto-dachi",   0.300, 0.470, 46.0, 40.0)]:
    v3 = py - ANKLE_Y; uh3 = 0.45*Sh
    chk(f"{label} front knee", knee_flex(math.hypot(uh3, v3)), wf, 0.8)
    chk(f"{label} rear knee",  knee_flex(math.hypot(Sh-uh3, v3)), wr, 0.8)

print("\n=== YOI / STANDING ===")
for label, Wy, want in [("heisoku", 0.055, 0.529), ("musubi", 0.030, 0.529),
                        ("heiko/hachiji", 0.259, 0.523)]:
    lat2 = abs(Wy - HIP_JOINT_SEP)/2
    y = ANKLE_Y + math.sqrt(leg_len(3)**2 - lat2*lat2)
    chk(f"{label} pelvis Y", y, want, 0.002)

print("\n=== ANKLE DEMAND / turnout ===")
for phi, want_df in [(30, 36.0), (45, 30.7)]:
    df = math.degrees(math.atan(math.tan(math.radians(40.0))*math.cos(math.radians(phi))))
    chk(f"eff. dorsiflexion, shank lean 40, phi={phi}", df, want_df, 0.3)
lift = HEEL_BEHIND * math.tan(math.radians(34.1 - 25.0))
chk("heel lift, phi=30 DF capped 25 (H)", lift, 0.0083, 0.0015)

print()
if FAILS:
    print(f"{len(FAILS)} FAILURES: " + ", ".join(FAILS)); sys.exit(1)
print("ALL CHECKS PASSED - 01-stances.md is internally consistent.")
