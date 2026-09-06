---
order: 1
name: SARATHI
kana: サラティ
tagline: Adaptive path planning for unstructured Indian roads.
context: SIH 2026 · SIH26037 · MathWorks · Robotics and Drones
status: shipped
stack:
  - Python
  - NumPy
  - SciPy
  - WebSockets
  - HTML5 Canvas
  - pytest
  - Playwright
  - uv
links:
  - label: Run it live
    href: https://sarathi.rishabhkushwaha.com/
    kind: live
  - label: Source
    href: https://github.com/Paragraph1148/automated-driving
    kind: repo
metrics:
  - value: "43.3%"
    label: Mean route progress
    note: against a lane-following baseline's 36.2%
    kana: ア
  - value: "8 / 10"
    label: Scenarios ahead
    note: same seeds, same sensor noise
    kana: カ
  - value: "46 ms"
    label: Median p95 replan
    note: inside the 50 ms that 20 Hz allows
    kana: サ
  - value: "155"
    label: Tests
    note: including behavioural regressions
    kana: タ
swaps:
  - from: Lane centreline as the planning frame
    to: A drivable corridor — a dynamic program over the free space ahead, re-solved every tick
  - from: Binary occupancy grid
    to: A continuous risk field — class-conditioned, harm-weighted, indexed by time
  - from: One predicted trajectory per agent
    to: Multi-modal intent — cut in, filter, dart, ride the wrong way — with covariance that grows
  - from: Obstacles are walls
    to: Potholes are traversable cost; the verge is drivable
  - from: A lane-change state machine
    to: Eight behaviours, wrong-way evasion included
benchmark:
  caption: Ten scenarios × three seeds × two controllers, on identical seeds and identical sensor noise. Sorted by margin, so the two losses sit at the bottom.
  unit: "% route progress"
  max: 70
  seriesA: SARATHI
  seriesB: Lane-following baseline
  summary: Ahead on 8 of 10 · mean 43.3% against 36.2%
  rows:
    - { scenario: School zone, a: 61.9, b: 27.3, clean: "3/3", p95: 47 }
    - { scenario: Village road, unmarked, a: 47.6, b: 30.4, clean: "2/3", p95: 47 }
    - { scenario: Dense market, a: 22.1, b: 13.0, clean: "3/3", p95: 72 }
    - { scenario: Highway merge, a: 40.3, b: 33.0, clean: "3/3", p95: 39 }
    - { scenario: Unsignalled junction, a: 48.3, b: 41.0, clean: "1/3", p95: 56 }
    - { scenario: Construction diversion, a: 27.4, b: 21.6, clean: "3/3", p95: 46 }
    - { scenario: Cattle crossing, a: 49.8, b: 46.7, clean: "3/3", p95: 45 }
    - { scenario: "Narrow bridge, oncoming", a: 61.2, b: 61.1, clean: "3/3", p95: 37 }
    - { scenario: Bus stop overtake, a: 34.6, b: 36.8, clean: "3/3", p95: 38 }
    - { scenario: "Night, wrong-way rider", a: 40.2, b: 51.6, clean: "1/3", p95: 37 }
limits:
  - It is not yet safer than the baseline by raw contact count — 25 of 30 runs finish clean against the baseline's 27. Three of those five contacts happened with the vehicle stationary and another road user driving into it, which is a different failure from one we drove into, so every contact is recorded with our own speed and the bearing of the other body.
  - The dense market peaks at 72 ms and is the one place the 50 ms replan budget is exceeded.
  - The vehicle is over-cautious in dense traffic, and two scenarios account for four of the five contacts.
  - Prediction priors are hand-built rather than fitted to data.
---

### The idea

Every production autonomous-driving stack assumes a **lane**. Indian roads do not
have lanes. They have a negotiated, continuously deforming free space shared by
buses, auto-rickshaws, two-wheelers filtering through 60 cm gaps, pushcarts,
pedestrians crossing wherever they like, and cattle.

So the two primitives that break down there were replaced rather than patched.
Because it never needed lane markings in the first place, it degrades gracefully
when they are faded, absent, or simply wrong — there is no branch anywhere in the
code for "markings missing".

### The diagnosis

The planner would not pull away from a stopped obstruction. The reflex is to reach
for the thresholds, and there are 31 of them to reach for.

Instead I counted what the lattice was throwing away. Of 131 candidate
trajectories, **1** was usable. That is not a threshold problem — a threshold
problem does not leave you with one survivor out of a hundred and thirty-one. It
is a sampling problem: candidates were being generated outside the reachable set
and then discarded, correctly, for being infeasible. The planner was doing the
right thing with the wrong material.

Sampling inside the reachable set, and re-parameterising the lateral profile by
distance travelled rather than by time, took the usable fan from 1 to somewhere
between 35 and 50. No threshold moved.

### The evidence

Every number here comes out of `scripts/benchmark.py` — ten scenarios, three
seeds, two controllers, identical seeds and identical sensor noise for both. The
baseline is a fair comparison rather than a straw man: it sees the same sensors
and the same noise, and it mostly fails by stopping rather than by crashing, which
is exactly why the contact counts are close while the progress numbers are not.

Both presentation decks read that same JSON and refuse to build without it, so a
figure on a slide cannot drift away from what the code actually does.
