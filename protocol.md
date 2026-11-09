# 谷の採鉱競争 — authoritative protocol

Same-origin WebSocket `/ws`, JSON text. Clients own responsive movement; the server validates poses and owns strikes, mining, harvesting, theft, sale, investment and final results. Fixed simulation rate20Hz, round180s, result display8s. Coordinates are metres: +Y up, +Z forward. IDs are opaque strings.

## Shared configuration and geometry

`Unity/Assets/Resources/valley.json` is the single authored source; deployment copies it to `/app/valley.json`. Schema version1, worldId `mining-valley-investment-v3`. Bilinear height interpolation uses the z-major grid, clamped at its edges. Walk4.317m/s, sprint5.612m/s, sneak1.295m/s, boundary±58m. Player y is the feet, height1.75m, radius0.45m, eye1.62m above ground. Java 1.8.9 movement uses ground acceleration0.1 (sprint0.13), air0.02 (sprint0.026), ground friction0.546, air0.91, jump0.42 blocks/tick and sprint launch+0.2 blocks/tick. There is no stamina limit.

Major obstacles and deposits are solid upright cylinders based at interpolated ground height. Append deposits after colliders for movement prediction. Substep displacements at most0.25m per axis, then push out in list order for3 passes. All deposit cylinders remain solid when depleted/inactive. The shared list includes the north cart, east survey table and south hoist. Rendering does not replace these collision footprints.

Authored deposit fields are `{id,kind,x,z,radius,height,weakX,weakY,weakZ}`; authored weak coordinates are offsets from the ground-based deposit origin. Snapshot weak coordinates are absolute world positions. A strike traces from authoritative eyes for less than2.7m: terrain, props, deposit bodies and other player bodies can block it. The nearest hit wins. A live deposit's weak sphere has radius0.22m; it is a weak hit only when its sphere is hit before its body. After a hit the weak point moves across an exposed upper face. Ordinary hits remain valid. Client aim hints use the same sphere/cylinder/terrain rules.

|Pick level|Acquisition cost|Normal / weak damage|Interval|
|---|---:|---|---|
|1|0|1 /2|0.68s|
|2|8|2 /4|0.60s|
|3|12|3 /6|0.54s|
|4|18|4 /8|0.49s|
|5|24|5 /10|0.45s|
|6|32|6 /12|0.41s|
|7|44|8 /16|0.37s|
|8|60|10 /20|0.34s|

|Ore ID|Value/unit|HP|Yield|Required level|Regrowth|
|---|---:|---:|---:|---:|---|
|copper|2|3|2|1|6s|
|silver|5|8|2|1|9s|
|crystal|12|30|2|1|20s|
|ruby|20|48|2|1|32s|
|diamond|14|90|6|1|45s|
|gold|28|surface12, main36|1 per layer|1|until exhausted|

Clients read `picks`, ore records and current snapshot fields rather than maintain another price/damage table.

## Join and input

```json
{"type":"join","name":"旅人"}
{"type":"welcome","id":"player-id"}
{"type":"input","x":0,"z":1,"ax":0,"ay":0,"az":1,"fire":false,"sprint":false,"sell":false,"upgrade":false}
```

Input is normalized world-space XZ movement and a normalized3D aim direction. Nonfinite inputs become0. fire is held left click/F; the server strikes when ready and repeats while held. A tap is retained for the next tick. sprint is Shift or W double-tap, sneak is C, jump is Space, sell is E, upgrade is Q. Action inputs expire after0.6s.

Movement packets additionally contain `motionSeq,motionRound,motionTime,px,py,pz,correctionId,impulseId,sneak`. motionTime is cumulative simulated client seconds, poses are feet in world metres. The server checks finite values, elapsed-time budget, speed including jump/knockback momentum, terrain/cylinders, height and flight. Bound checks run before geometry. Packets from a previous round or with an old sequence are ignored. Modern clients do not get a second held-input simulation on the server, including during lost/delayed input. Normal snapshots acknowledge poses and never move the local camera. Only spawn/rematch and a new `correctionId` adjust it; `correctionX/Y/Z` are applied once as a delta, preserving subsequent input. `impulseId` identifies a velocity replacement in m/s (`impulseX/Y/Z`), applied once by the client. Old poses cannot overwrite a new impulse until they acknowledge its ID. Remote players interpolate received poses, and reset at rematch.

E is a continuous held intent, including outside shops and with an empty bag. A loaded player sells after1s inside the common4.5m station radius; movement is allowed. The batch and its whole-bag price lock when that hold starts, including across the buying light switching. Later receipts remain for the next held-E batch. Releasing E, holding Q/B, attacking or leaving cancels. Empty/repeated input cannot pay twice. Q buys the next pick; B sends expand:true and buys the next bag capacity. Both need1.8s in the same circle, sufficient banked points and release before another purchase. E/Q/B simultaneously cancel all three. Each successful purchase increments investmentSpent; bags also increment bagInvestment. Bag records in the shared config are8 slots/free,12 slots/12 points,16 slots/20 points. These are per-player limits for every mining/pickup/melee/arrow path. No purchase acts during results; rematch resets the bag to8.

Up to8 humans. Rejoining creates a new ID. The supplied name is trimmed, stripped of controls/angle brackets and limited to18 characters; an empty name becomes旅人. Existing display names stay stable. A collision gets a free suffix starting at2 (`旅人`, `旅人 2`). Used names remain reserved through the round, including recent receipts and frozen results. Use IDs for identity and the server name consistently for nameplates, contest feedback and results.

### Bow input

Everyone owns a bow. 1/2 select `weapon:"pick"|"bow"`; R remains an alternative. Left click uses normal melee (only the pick mines); right/F hold draws the selected bow, release fires. While using the bow, left presses are consumed without cancelling the draw or adding a release-frame melee attack. Explicit `bowDrawing:true` starts an authoritative draw at receipt, before motion is validated. Players publish `bowDrawing,bowDrawStartedAt,bowAimPitch` (pitch in radians). A release sends `bowDrawing:false` with a new monotonic `shotId`, `shotTime,shotAx/shotAy/shotAz`. No client charge/power is trusted. The server derives integer20Hz draw ticks; fewer than3 do not fire. Each shot needs a fresh actual draw. There is no separate reload timer.

Switching, cancelling without a new shotId, Tab/Esc/blur, active shop sale/upgrade, stale input0.6s, finish and rematch cancel use. Releasing a cancelled hold cannot shoot. Old-round and duplicate releases, invalid directions and unbounded queues cannot produce arrows. shotTime is an intent freshness hint (up to0.6s old, at most50ms future), not target rewind. The server captures its accepted eyes and release aim. A saved press expires after250ms awaiting simulation. Loaded in-range E retains priority; E outside the shop leaves the bow usable. Clock recovery discards old flight/draws rather than granting retroactive damage.

## State packet

```json
{
  "type":"state","worldId":"mining-valley-investment-v3","round":1,
  "phase":"playing","timeLeft":180,"resultTimeLeft":0,
  "players":[],"deposits":[],"stations":[],"picks":[],
  "goldLayers":[6,24],"rareNextIn":50,
  "localClaims":[],"events":[],"standings":[],"winners":[]
}
```

Missing players left the live room. Snapshot heights are authoritative, yaw is radians with0 along+Z. Time fields are remaining seconds, progress and stamina are normalized0..1.

### players[]

Each row contains:

- Identity/pose: `id,name,bot,x,y,z,yaw`.
- Bag: `inventory:[{kind,count}],inventoryCount,inventoryValue,bagCapacity,bagLevel,bagUpgradeCost,bagUpgradeCapacity,bagInvestment`. Base value is unawarded until sold. Next cost/capacity are0 at maximum.
- Accounting: `score,grossSales,investmentSpent,goldSold`. Score=grossSales−investmentSpent. goldSold counts completed sales, including stolen gold later sold.
- Pick/purchase: `pickLevel,upgradeCost,upgradeProgress,upgradeKind,upgradeReady,upgradeHeld`. The shared progress is labeled by upgradeKind=pick|bag, and the server latches one completed physical hold.
- Sale: `sellProgress,sellValue,saleQuotes:[{stationId,baseValue,bonus,value}]`. value=baseValue+bonus, where bonus is the extra baseValue at the hot2x shop. sellValue retains the exact accepted batch price, otherwise0.
- Other: `stamina,sprinting,stationId,protected,invuln,joinedLate`. stationId is empty outside the common sell/protection circle; invuln remains0 for compatibility. joinedLate marks a human joining after the first second, without compensation. There are no order, first-delivery or cargo-tag fields.

### Consumed frame acknowledgement

A protocol2 client may send `{"type":"ack","ack":N}` after frame N has been applied to Unity. This only releases existing stream credit; it never changes movement, aim or held actions. A normal input in that same rendered frame carries the ACK instead. The browser sends no repeated/empty ACK, checks the existing8192-byte outgoing-buffer bound, and does not acknowledge replaced sockets. The server keeps its three outstanding-frame and80 incoming-message/s limits. Older clients continue to piggyback `ack` on ordinary inputs.

### Bow and arrows

`bow:{tickRate:20,fullDrawTicks:20,minDrawTicks:3,projectileSpeed:60,gravity:20,dragPerTick:0.99,maxFlightSeconds:8}` appears in state/full frames and health.rules. `bolts[]` is the existing projectile collection with immutable rows `{id,ownerId,shotId,x,y,z,vx,vy,vz,power,spawnTime,expiresAt}`; velocity is initial m/s, not blocks/tick. Joins receive live arrows; full/rematch replaces IDs; departed owners cannot damage later. `removedBolts[]` removes a collided/expired arrow. Launch metadata is sent once, with no per-tick projectile coordinates. Browser batches merge additions/removals before Unity consumes them; final authoritative contact comes from bolt-impact.

Human arrows echo the accepted `shotId` in both launch metadata and the `shot` event; `shot` also includes `spawnTime`. NPC arrows use0/no request ID. This is correlation only: it cannot choose power, birth time, collision or the recipient. A rate-limited `shot-blocked` reply carries the rejected request ID and `reason:"draw"|"safety"`; duplicate IDs never launch or repeatedly acknowledge.

The firing client may show one cosmetic arrow immediately on a locally valid release. It hands that same view to the matching authoritative arrow, blending its position onto the accepted flight without replaying the release sound. Local scenery can stop this cosmetic flight, but cannot award ore, damage, knockback, hit tint or a hit marker. Those still require the server impact/transfer. Rejected predictions clear by request ID; an unconfirmed view expires after0.6s and all clear on rematch/finish.

For exact20Hz rendering, let n=floor(age*20), a=age*20−n, d=.99, D=d^n, S=(1−D)/(1−d). Position X/Z is origin+initialVelocity*(S+aD)/20. Position Y additionally subtracts .05/(1−d)*(n−S+a*(1−D)). This means move first, then drag, then gravity on each original tick; it is not a continuous gravity parabola. The same closed form drives server sweeps and Unity. Arrow origin is eyes−0.16m along the local right vector and−0.1m vertically.

### deposits[]

Each row has `id,kind,x,y,z,weakX,weakY,weakZ,hp,maxHp,looseCount,respawnIn,minerId,active,minLevel,availableIn,announced,opensIn`.

`hp/maxHp` describe the current layer. Normal deposits stay active even when hp=0 and use respawnIn. minerId is the latest damaging player for up to1.5s, cleared on depletion. Gold adds `layer,layerCount,remainingYield`: layer1=surface,2=main seam,0=not yet opened; layerCount=2. Gold remains solid before/after exposure. availableIn on an inactive gold candidate is time until the next shared wave, not a promise that this site will be selected.

### stations[] and market

Rows contain `id,name,x,y,z,radius,safeRadius,multiplier,hot,hotSeconds`. All3 shops accept every ore at the same base unit prices. Exactly one shop at a time buys every ore for2x, shown by teal buying lamps, a cloth2x sign and the actual quoted amount. It changes shop every30s, with the initial shop rotating on rematch. There are no requested ore kinds, first arrivals, reservations, future-price previews or participant-specific rewards. The whole quoted batch price locks on sale start. hotSeconds is a presentation hint; no countdown is required to play.

All shops share one inclusive4.5m boundary for selling, purchase and protection; safeRadius is a derived wire alias of radius. Ground and survey show one yellow circle. AI route/range and combat use that same boundary.

## Mining, gold and theft

Damage contribution is actual damage capped at remaining HP. All six ores accept every pick level. On depletion, a precision finisher with at least one quarter of that layer’s maximum HP contributed (rounded up, minimum2 actual damage) receives the ore. A small last tap below this threshold cannot take it. A body finish, or a finisher below the threshold, awards the ore to the highest contributor still within horizontal distance `range+deposit.radius` and with bag space; ties favor earlier contribution. This is a current eligibility check, not ownership. Ordinary yield is authored (2, or6 for the single hard diamond): units that do not fit the recipient's bag remain as `looseCount` on that already broken seam. Any miner with space can recover them with one valid swing on the rock or the visible fragment (sphere radius0.20, center at seam x/z and base+height+0.075). Reaching regenAt never erases fragments: a normal seam regrows only after all remaining fragments are collected. The round reset clears them; intact seams never spawn loose items. A full bag cannot mine or collect fragments.

Gold first opens at elapsed32s in one of4 sites, chosen at the common6-second announcement using private randomness independent of BOT decisions. Once exposed, it has no deadline: HP, contribution and loose ore remain until collected or the match ends. Only full depletion starts the next6-second announcement, at a different site. There is no periodic relocation and no expiresIn field. The public preview/exposed seam alone enables the depth-tested mineral light, fading near the face. Ordinary deposits number23:8 copper,6 silver,6 crystal,2 ruby and1 diamond.

Gold exposes a12HP surface yielding1, then a36HP core yielding1. Overflow and contribution do not carry between those layers. Each layer uses the same existing contribution rule. All ordinary yields use the same bag-space/loose-fragment rule; diamond6 can fill a mixed bag partially, leaving the remainder on the seam until collected.

Every accepted player hit transfers exactly one item when the victim has any cargo and the attacker has space. The final item is transferable; there is no separate theft cooldown. A carrier robbed from a full bag immediately has room to reclaim an item, including a thief's sole item. Empty targets and full attackers still receive the ordinary body hit/knockback but transfer nothing. Banked score never moves with a hit. Either participant inside any safe circle blocks both knockback and theft, and produces `protected` feedback. Upgrades never increase player reach or units stolen. Other player bodies still occlude a ray even when a transfer is ineligible.

BOTs may briefly approach a visible carrier crossing their route (within6.2m, at most1.6s), including when carrying their own cargo with room remaining. Other opportunities last at most2.4s and stop after one press. A personally experienced theft is remembered for3s: a visible, reachable thief within4.8m may be pursued for at most1.8s, with a0.12s initial reaction. On reclaiming one unit, the BOT prioritizes banking for2s, with no renewed pursuit; an in-reach defensive press remains possible while withdrawing. These are NPC decisions, never immunity or a new player cooldown. They use the same queued entity strikes, reach, visibility, safe circles and hurt checks, independently of the mining cooldown. Hidden opponent inventory composition and distant movement are not read to select a counter.

### Java 1.8.9 bow baseline and project rules

Draw power is p=min(1,(u²+2u)/3), u=drawTicks/20. p<.1 does not fire, making3 ticks the first valid release. ItemBow passes2p to the arrow constructor, which multiplies1.5: full draw is3 blocks/tick=60m/s. Air velocity decays0.99/tick; after movement, Y velocity loses0.05 blocks/tick. Full charge takes20 ticks, with no weapon recharge. Initial normalized direction receives the original Gaussian inaccuracy0.0075 per component.

The projectile tests actual current movement, without melee's target rewind, against player AABB expanded0.3m (half-width0.6, Y from feet−0.3 to feet+2.1). Terrain, exact scenery-rock mesh, props, all deposit bodies and the first player body stop it, including empty/full/hurt bodies. Removed passage rocks cease to occlude it. Sweeps include movement inside the20Hz tick. Ground contact solves each crossed bilinear height cell along the actual segment, including interior crests and upward segments; arrows use the real surface, while ordinary rays retain their0.03m terrain padding and clear-ray limit semantics. Cleanup occurs at the field boundary or after8s instead of a fixed24m reach.

Accepted arrow strength follows EntityArrow's ceil(current speed in blocks/tick ×2), plus a full-draw critical random integer in[0,floor(strength/2)+1]. Shared hurt keeps the highest accepted strength during its10 ticks. A stronger arrow may pass a weaker hit without a second base knockback. Fresh accepted contacts use the shared base knockback, with no sprint bonus or shooter slowdown. This strength orders hits only: there is no HP, and each accepted transfer remains at most1 item including the final item. Empty/full bodies receive the accepted contact/knockback without moving ore. Existing banked score and shop safety rules remain authoritative at contact. Safe cylinders do not absorb arrows. A protected body is skipped at its swept contact time, so an arrow can pass through the station and reach an unprotected target beyond. Entering protection after firing does not cancel an arrow already in flight. Launches from protected positions remain rejected.

NPCs draw14–20 ticks at a visible7–24m opportunity, with observed-pose aim rather than hidden future movement. They avoid human targets during the first15s of the round, leaving human pairs and NPC pairs unchanged; late join never restarts that window. They return to pick/ordinary trading afterward. The game supplies unlimited arrows and no durability, water drag, enchantments or HP. The requested wide fixed FOV and camera-shake-free presentation override the original bow FOV effect. Wood geometry and synthesized audio are original assets; no original source, textures or audio are distributed.

Reference checked2026-11-08 using the installed official1.8.9 client jar, SHA1`3870888a6c3d349d3771a3e9d16c9bf5e076b908`, and [Forge MCP1.8.9 SRG](https://maven.minecraftforge.net/de/oceanlabs/mcp/mcp/1.8.9/mcp-1.8.9-srg.zip). Reproduce with `javap -c -p -classpath <official-1.8.9.jar> yt`, `wq`, and `bew`: ItemBow.onPlayerStoppedUsing (`yt.a(zx,adm,wn,int)`), EntityArrow shooting constructor/heading/update (`wq`), and EntityPlayerSP.onLivingUpdate (`bew.m`). The first provides the20-tick curve/threshold and bow sound pitch; the second the×1.5, Gaussian spread, origin offsets, entity expansion, drag/gravity and strength; the last the using-item input×0.2. No extracted bytecode/source is tracked.

### Java 1.8.9 melee baseline

The selected reference is **Minecraft Java Edition 1.8.9 survival, no enchantments**, not the post-1.9 attack charge system. Entity selection traces at most3m from eyes against an axis-aligned0.6×1.8m body expanded by its0.1m collision border. This differs from the physical movement footprint and from mining reach. Terrain, props and deposit bodies still occlude the selection; the closest body wins.

Each physical left-click/F press sends a new monotonic `attackId`, `attackAx/attackAy/attackAz` and `attackTime`. The click's aim is frozen and processed on the next tick, independent of the pick's mining cooldown and of its visual windup. Repeated input packets carrying the same id cannot attack again. Holding the button repeats mining only; another entity attack requires another press. `miningOnly:true` distinguishes those held mining pulses from legacy clients. There is no weapon charge meter. Empty-space repeat swings have a10-tick delay; a later press correctly aimed at a reachable rock or player bypasses that empty-miss delay. This retargeting exception is a usability adjustment to the baseline. Equal hits on a victim are rejected for10 ticks (0.5s), shared by all attackers; there is no additional ore theft window. A falling critical is stronger and can pass that window, with no second base knockback; this game has no health/damage/death system. `hurtUntil` is the absolute server-time deadline for that short hit window, not a decreasing metadata timer; the UI distinguishes it from shop protection and inventory eligibility.

In metres/second, base knockback halves each existing velocity component, adds8 horizontally away from the attacker, and sets vertical velocity to `min(8,oldY/2+8)` even in the air. Sprint knockback then **adds**10 horizontally along the attacker's facing and2 vertically, without another halving; from rest the totals are18 horizontal and10 vertical. A successful sprint hit multiplies the attacker's horizontal velocity by0.6 and stops sprinting, allowing the usual release/restart sprint reset. `applyKnockback` replaces total velocity and increments `impulseId`; the client applies each id once. Collisions and subsequent motion determine actual travel distance.

State includes monotonic `serverTime`. Remote presentation interpolates position and `renderTime` together from the same two authoritative snapshots, with a75ms presentation buffer. It clamps at the newest real pose during missing packets and resets across teleports/rematches; it never invents a newer timestamp for a frozen body. Attacks send that viewed time. Server pose history remains bounded to0.25s. Future or older attack times are rejected rather than extending reach; old-view rejections produce a rate-limited `guarded/late` hint. Legacy packets without a view time use the current pose. Both the historical strike ray and current line of sight must remain unobstructed. The current check traces from the attacker's current eyes to the selected body point translated onto the victim's current pose; an exposed head must not fail a second check to a hidden torso. No client-selected victim id, damage, theft quantity or impulse is trusted. Protection and inventory eligibility are evaluated at resolution, so rewinding cannot bypass a safe circle or duplicate a transfer. This bounded rewind is a deliberate network adaptation, rather than a claim that this server runs Minecraft's packet protocol.

Reference checked2026-11-08: the installed official [1.8.9 client jar](https://launcher.mojang.com/v1/objects/3870888a6c3d349d3771a3e9d16c9bf5e076b908/client.jar), SHA1`3870888a6c3d349d3771a3e9d16c9bf5e076b908`, inspected with `javap -c -p`; names resolved using [MCP1.8.9 SRG mappings distributed by Forge](https://maven.minecraftforge.net/de/oceanlabs/mcp/mcp/1.8.9/mcp-1.8.9-srg.zip). Relevant methods: `ave.aw()`/Minecraft.clickMouse, `bfk.a(float)`/EntityRenderer.getMouseOver, `pr.a(ow,float)`/EntityLivingBase.attackEntityFrom, `pr.a(pk,float,double,double)`/knockBack, `wn.f(pk)`/EntityPlayer.attackTargetEntityWithCurrentItem, and `pk.g(double,double,double)`/Entity.addVelocity. The official jar was hash-verified; no extracted source or bytecode is stored in this repo.

## Events and participant feedback

Events are `{id,type,actorId,targetId,kind,x,y,z,amount,value,bonus}`. Retained for0.55s; deduplicate string id across snapshots. Position is the hit point, station centre, or eyes for swing. Generic defaults are empty strings/0.

|type|Meaning|
|---|---|
|shot|Bow release; weapon=bow, projectileId, origin x/y/z, vx/vy/vz, power, drawTicks and critical. One per accepted release, independent of transfer.|
|shot-blocked|Bow release rejected by safety; weapon=bow, reason=safety, at most once per0.35s per shooter. No projectile or melee effect.|
|bolt-impact|Arrow stopped; weapon=bow, projectileId, final x/y/z, impactTime (exact authoritative server contact time), power, critical and optional victim targetId. reason=hit/empty/full/hurt/safety/terrain/range. No melee hit event; fresh accepted contact uses ordinary KB. Only hit accompanies one steal event.|
|swing|Pick swung; may be followed by a hit event|
|mine /weak|Normal/precision damage; amount is actual damage|
|hard /full|Required pick level in amount /bag prevents mining|
|harvest|Recipient actorId; amount is units added, value is base value. finisherId identifies the last striker separately from the recipient. looseCount, when positive, is the uncollected remainder. pickup=true denotes a later swing collecting the already broken remainder, not another rock break.|
|steal|Attacker actorId, victim targetId, one transferred unit. Bow transfers additionally carry weapon=bow; absent weapon denotes the existing pick route.|
|hit|Attacker actorId, victim targetId; confirmed body hit, kind=normal/critical/sprint; independent of ore transfer. Optional meleeReason=empty/full identifies why that hit transferred no ore, sampled before the transfer attempt.|
|guarded|meleeReason=hurt: an equal/weaker press was rejected during the existing hurt window, at most once per0.35s per attacker, with the selected body in targetId. meleeReason=late: viewed time was older than250ms when received, at most once per0.75s, without a selected body. Neither applies impulse, red tint, hit sound or loot transfer. The client briefly dims its aim mark and preserves a preceding confirmed receipt.|
|protected|A body was selected but a safe circle blocked the attack|
|sold|Bag sold; amount is units, value is the paid quoted total, bonus is the whole-bag hot-price increment. No order/deadline/lost-race fields.|
|upgraded|Station targetId, amount is new pick level, value is paid price|
|bag-expanded|Station targetId, amount is new capacity, value is paid price|

Gold harvest adds `layer:1|2,layerCount:2`, amount1/value28. No extra harvest event is emitted for changing layers.

`localClaims` is personalized: only contributors currently within8m receive their nearby feedback. Current leadership is sent after at least2 people damaged that layer. Rows are `{depositId,layer?,contested,leaderId,leaderName,ownDamage,finishRequired?,status,resultId,resultAmount,resultAge}`. Status is leading/trailing, bag-full or too-far. Empty arrays clear old status.

Receipts last4s after harvest. They use received/other-received, the actual recipient's leaderId/Name, and actual resultAmount. Gold also sends solo receipts with contested=false. A gold deposit may have a surface receipt and main-seam leadership/receipt at once. Key current leadership by `(depositId,layer)`, receipts by resultId. Harvest event.id=resultId; deduplicate across both channels and do not collapse two layers into one deposit-level notification. Work/results clear on regrowth or the next exposure.

Receipt resultReason explains that viewer's outcome using facts frozen at the break: precision (a qualified weak finish), contribution (the highest eligible work), nearby (the top contributor was ineligible), not-enough (this viewer's finish lacked the required work), not-weak (this viewer's body finish did not override the leader), bag-full, or too-far. finishRequired retains the threshold for that completed layer. Later movement, sale, or another layer cannot rewrite the cause.

## Start, result and rematch

Each participant reserves one authored copper starting location until leaving. BOT departure frees it. Late joins use a free location without granting/regenerating ore or resetting the clock, even if the free seam is depleted. This reserves placement only, not mining rights. Rematches rotate offset and odd stride around8 starts; a stable roster cycles through all8 locations and24 location/initial-market combinations.

The first human in an empty unfinished room receives180s. A playing room becoming empty resets. Results keep ticking even if everyone leaves, then the next empty room waits at180s. A late playing join starts Lv1/zero accounting/empty bag with the existing time. A results-period join sees that frozen result and joins play on rematch.

On the ending tick, valid actions resolve before the final table is copied. `standings` is empty during play and frozen during results. Rows are:

```json
{"rank":1,"id":"A","name":"旅人","bot":false,"pickLevel":3,"grossSales":116,"investmentSpent":38,"score":78,"goldSold":2,"bagCapacity":12,"bagInvestment":12,"inventoryCount":1,"inventoryValue":10}
```

Sort by score descending; equal scores share rank (1,1,3), with join order only for stable presentation. winners contains copied `{id,name,score}` rows at rank1. Gear, name, bot flag, accounting and ranks never follow later live-player changes. Departures remain in standings, results-period joins are absent; a client can show “次の試合から参加” when its ID is absent. After8s, increment round and reset standings, accounts, gear, bag, work, layers and joinedLate. No input can act during results.

## BOT knowledge and runtime

BOTs share movement, resources, pick costs, contribution and protection rules. Normal ore is observed within40m with unobstructed sight; exact HP/regrowth only within8m. Out-of-view knowledge is remembered/estimated. Markets and selected gold announcements are public. A BOT may pursue a nearby visibly loaded player only while empty, for at most2.4s and one swing, then disengages with cooldown. The human's first copper seam is avoided for15s. There are no private reward multipliers or population-based gold/price changes.

BOTs no longer infer requested contents from cargo tags or chase first deliveries. They compare the currently visible whole-bag shop value with the actual route, and re-evaluate on arrival. Mining and investment use the current target and remaining match time, not predicted gold expiry/wave counts or undisclosed future shop states. One bag expansion is available to a sufficiently funded Lv3 BOT with more than50s left, through the same B-style hold and payment.

The runtime compensates ordinary callback lateness on a monotonic20Hz schedule and coalesces snapshots on catch-up; it does not replay a long suspension as an unlimited burst. `/health` reports worldId, canonical shared configHash and actual rules including spawnPolicy=reserved-rotating. Experiments remain under server/dev and are not runtime fields or environment switches.


## Protocol 2: consumed-state deltas

Clients opt in with `{"type":"join","protocol":2,"name":"旅人"}`. A welcome echoes protocol2; legacy joins retain complete `state` packets. Both versions share one simulation and accounting. Inputs add `ack`, the highest frame actually consumed by Unity, not merely received by WebSocket.

A protocol2 packet is `{"type":"frame","seq":1,"full":true,...}`. The first packet, reconnect and every new round have a complete baseline: players, poses, deposits, stations, picks, goldLayers, standings and winners. Subsequent packets carry whole changed entity rows (upserts by opaque id), `removedPlayers`, latest clock/phase/claims and newly emitted events. Omitted arrays retain their previous values; empty arrays clear them. Never interpret a missing array as deletion. TCP ordering plus contiguous per-connection seq supplies the delta baseline; a sequence gap closes the broken stream rather than silently inventing state.

`players` contains slow metadata/accounting without motion. `poses` contains id/x/y/z/yaw for remotes; the viewer's row also contains pose acknowledgement, corrections and impulses/velocities/grounded. Metadata replacement retains the latest pose, including when that pose did not change. Wire spatial values use millimetre precision, yaw0.001 radians, timer hints0.2s. Scores, counts, contribution and prices remain exact integers. Every20Hz frame carries serverTime/timeLeft/resultTimeLeft at0.001s precision. Current deposits/markets are known globally; their timer hints are not authority for action eligibility.

The server prepares shared state once per pump, not once per recipient. Each connection can have at most three unconsumed frames; when full or its write buffer exceeds8KiB, it retains no queued snapshots and computes the next delta from the last sent baseline only when it can send again. Simulation, round clocks and other clients keep running. There is no timeout-based loss of an otherwise live participant or their score. Browser input also stops appending when its send buffer exceeds8KiB; the next input replaces held movement/action state.

The browser merges upserts, removals and all unique event rows across received frames, then passes one batch to Unity per rendered update. ACK advances after that consumption. Unchanged entities retain C# objects/arrays, and only changed veins update their visual state. Events are sent once per connection, rather than repeating their0.55s retention window in each snapshot. After a long pause, accounting, motion and world state catch up from the latest server state; expired effects are not replayed. Reconnect and rematch rebuild baselines and suppress historical audio. Replaced sockets cannot deliver close/error callbacks into a new session. Old-round inputs are ignored before any actions are accepted.

The simulation remains20Hz. After a process stall it expires the excess wall-clock interval first, then executes at most five recent simulation ticks. Skipped time advances phase/round timers, event expiry and movement budget, without granting travel, strikes or sale/upgrade hold progress. Queued clicks waiting more than0.25s after receipt expire; the separate0.25s viewed-pose rewind check still runs when the click arrives. This avoids permanently losing round time while also avoiding an unbounded replay burst.

The design borrows Minecraft's separation of entity motion, metadata and initial spawn/teleport state, rather than its packet format. Checked2026-11-08 against the hash-verified official1.8.9 client jar linked above: `lh.a(java.util.List)` / EntityTrackerEntry.updatePlayerList emits `gv$a/b/c` relative-move/look variants, falls back to `hz` teleport, and `lh.b()` emits dirty `hk` metadata. `lh.b(lf)` supplies an entering viewer's complete entity state. The Forge SRG mapping resolves those names. Minecraft Bedrock's [official conditional bandwidth optimization documentation](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/entityreference/examples/entitycomponents/minecraftcomponent_conditional_bandwidth_optimization?view=minecraft-bedrock-stable) independently distinguishes smaller motion packets from full spatial updates. This project keeps all eight participants and mine status globally visible, using changed-state replication and consumption backpressure rather than copying Minecraft view-distance rules.

Further1.8.9 bytecode checks distinguish the authoritative entity position from its displayed pose. `bcy.a(gv)` / NetHandlerPlayClient.handleEntityMovement adds signed relative deltas to integer `serverPosX/Y/Z`, converts from1/32 block units and sets the latest interpolation destination for3 ticks. `bcy.a(hz)` / handleEntityTeleport replaces that integer position. `lh.a(List)` uses relative deltas only within signed-byte range and falls back to absolute teleport for larger changes or a resynchronization; the delta baseline is not the floating-point rendered position. `bex.a(DDDFFIZ)` / EntityOtherPlayerMP.setPositionAndRotation2 replaces its destination, while `bex.m()` / onLivingUpdate approaches that latest destination over the remaining ticks. It does not queue every old movement target as another future animation. These observations support keeping delta baselines and presentation interpolation separate here; the1/32 quantization and3-tick interpolation are not copied into this game's wire format.

Transient actions are separate again: `bcy.a(fq)` / handleAnimation dispatches S0B animation0 to swingItem; `bcy.a(gi)` / handleEntityStatus dispatches S19 status to the entity; `bcy.a(hm)` / handleEntityVelocity applies the separate S12 velocity scaled by1/8000. Movement rows therefore do not imply a repeated swing, hurt effect or impulse. This project's event ids and impulse ids provide that separation over its own consumed-state stream. All methods were inspected with `javap -c -p` against the same official1.8.9 jar and Forge mappings above; extracted bytecode is not committed.

The final receive window is3, selected from a local two-peer jitter comparison. With50ms input ACK cadence and nominal60–120ms RTT, the former2-frame window consumed about10.14 updates/s and rejected4/42 clicks after viewed poses exceeded250ms. The3-frame window consumed15.86 updates/s in the corresponding comparison, rejected0/42 and stayed bounded at3 outstanding frames. `node --test server/melee.test.js server/melee-stream.test.js server/stream.test.js` checks the real WebSocket/browser bridge, interpolated crossing-target selection, burst-to-single delivery, receipt-time versus viewed-time expiry, and event non-replay. This is a synthetic receive/render consumer, not a WebGL FPS or human aim measurement. The3m reach,250ms viewed-pose limit,250ms post-receipt queue expiry and weapon rules are unchanged. Full-length load measurements and the older2-frame baseline are distinguished in [network comparison](server/dev/network-comparison.md).

## 2026-11-09 対象へ道具を使う

input.weaponはpick/bow/bag。input.use（主操作の保持）とuseId（押下ごとに増える整数）を送信。新しいuseIdの受信時だけ権威側が視線と買取台/アンビルの対象を確定し、保持途中に別対象へ移しても購入を開始しない。stationsはanvilX/Y/Z/Radius・counterX/Y/Z/Radius・useRange=3を配信し、円内かつ同じ対象への視線を継続すると売却/強化。各useIdで一取引まで。アンビルではweaponに応じピック/袋を強化し、弓・最大・不足・空袋はworkshop-denied(reason,value,kind)。旧クライアントとの互換として旧sell/upgrade/expandを受理するが、useIdを送るクライアントには旧フラグを使わない。高値買取は通常袋総額×1.5を四捨五入し、受付開始時の値を固定。

## 2026-11-09 円内の自動売却・即時強化（現行）

売却は全プレイヤー/BOTについて円内かつ袋が空でないシミュレーションtickに、視線・weapon・use等と無関係に袋全体を一度だけ換金。通常/1.5倍はその時点のquoteを使い、空袋にはsoldを出さない。sellSeconds/upgradeSecondsは0。アンビルの新しいuseIdを受けた瞬間に射程/保護円/装備/資金を検査し、成立なら次tickで即時一段購入。短い押下のreleaseがtick前でも保持し、同一useIdの押しっぱなしは再購入せず、未照準からの接近・持替え・自動売却による資金増加も購入を再開しない。失敗したpressにはもう一度クリックが必要。旧クライアントのupgrade/expandは互換入力として残し、同じ即時強化とrelease latchを使う。

## 2026-11-09 売店中央のアンビル（現行）

全3店舗のanvilX/Zはstation.x/zと同じ。anvilYは同地点の地形高+.82、操作球半径.65、射程3m。counterX/Y/Z/Radiusは撤去し、売却の対象照準も持たない。売店の円へ入るだけで自動換金、中央アンビルに選択した道具を向けて一クリック強化する。左右小屋とランタンも円中央へ揃え、買取台メッシュを撤去した。

### 対人の横幅と命中加速（2026-11-09）

共有valley.jsonのcombatが正本。人物はX/Zのみ1.2倍、Yと足元は維持。対人のbody halfWidth=.36m、近接border=.1m・reach=3m・高さ1.8m、弓は既存border=.3mを同じbodyへ適用する。地形衝突の半径は変更しない。有効な近接hitだけ、空袋の相手でも攻撃者のmeleeBoostUntil=serverTime+2。入力加速度1.4倍、再命中は期限更新で加算しない。guarded/protected/miss/mining/矢は付与しない。playerとprotocol2 local pose差分にmeleeBoostUntilを含み、クライアントは推定サーバー時計で失効、再戦で0へ戻す。ジャンプ高/KB/視野は変えず、失効後の慣性だけ既存摩擦で減速する。

### 提案・投票（公開44より後の追加）

joinに任意のfeedbackKey（ブラウザ内に保存したランダム64桁hex）を付ける。サーバーはSHA256のみ保存し、公開viewへkey/hashを返さない。匿名のブラウザ単位であり、本人認証や複数ブラウザからの参加防止ではない。

試合終了の確定standingsで、BOT以外の首位（同率含む）へ1案の投稿権、首位以外へ1票の投票権を付与。各ブラウザ・試合で1回、後の試合では新しい権利。投稿前は候補0件でもよく、実際の勝者が投稿した案だけを共有する。実装済みの開発履歴は投票候補とは別に扱う。

client→ {type:'feedback', action:'view'|'propose'|'vote', text?:string, proposalId?:string}。server→ {type:'feedback', feedback:{storage:'cloud'|'file'|'memory', permission:{role:'winner'|'voter',used,roundKey}|null, proposals:[{id,text,author,votes,status:'proposed',isOwn,createdAt}],notice,unavailable?}}。最大180文字、制御文字除去、UIではrich text無効、HTMLへ文字を差し込まない。自身の提案への投票・重複権利使用・BOTの権利を拒否する。

Cloud Runは既存サービスのidentityで既存Cloud Storage bucketの専用objectへ保存する。権限追加/公開化/新規DBは行わない。各read結果とそのgenerationを組にし、ifGenerationMatch付き更新・競合時の再読込で票の喪失を防ぐ。ローカルはFEEDBACK_FILEを指定した場合にファイルへ原子的に保存し、指定なしは一時メモリであると表示する。再戦は既存8秒後のまま進み、記録画面中は本人の移動/攻撃入力を止める。AIの自動実装・配備はこの機能に含めない。

履歴サイトとの共通APIは GET /api/feedback（boardそのもの）、POST /api/feedback に {action:'propose',text} / {action:'vote',proposalId}。Authorization: Bearer <64hex key> を使用し、鍵をURLへ載せない。匿名GETは一覧のみでpermission=null、POSTの認証不足401・不正入力400・連打429・保存障害503等は {error:'短い日本語'} を返す。同originのPOSTのみ受け付け、HTTPの参照はgame WSへjoinしないのでhuman人数を増やさない。body上限2048byte、権利/文字数/自票/重複票はWSと同じFeedbackBoardで判定する。

WebGLは localStorage['valley-improvement-key'] を独立ページと共有し、既存PlayerPrefsの同名keyがあればその獲得済み権利を保つ値へ移行する。EditorはPlayerPrefsのまま。/history/ は public/history/ の相対資産を配信し、配備stageではpublic/を静的配信rootへ重ねる。通常の入口とゲーム内から同originの/history/へ移動し、ブラウザの前後移動と最新版へのリンクで戻る。新投稿は『これからの案』であり、開発中の本人提案に対する過去の反映記録とはデータ上も分離している。
