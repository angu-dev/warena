# Warena

1️⃣ Spieler & Steuerung
• Bewegung: WASD (8 Richtungen)
• Schießen / Angriff: Space → Richtung Maus oder Bewegungsrichtung
• Power-Ups: Slot 1–3 → Tasten 1, 2, 3
• Max Power-Ups: 3 gleichzeitig, neues überschreibt ältestes

2️⃣ Ziel der Runde
• Letzter Überlebender gewinnt
• Power-Ups + Arena-Elemente sorgen für Chaos
• Spieler werden aktiv zur Mitte / ins Geschehen gezwungen

3️⃣ Arena
• Prozedural generiert: Wände + freie Tiles
• Dynamische Elemente:
• Spikes (ein/aus)
• Lava (Instant-Kill)
• Temporäre Wände
• Teleport Pads
• Explosive Barrels
• Moving Floor / Conveyor
• Ice Tiles / Slippery Floor
• Bouncy Pads / Trampoline
• Falling Blocks
• Mini Tornado / Gust Tiles
• Zentrale Hazard-Zone / Shrinking Arena: zwingt Spieler Richtung Mitte
• Power-Ups in der Mitte: High-Risk / High-Reward

4️⃣ Power-Ups
Freeze
Effekt: Gegner 2–3 Sek handlungsunfähig
Dauer: Instant

    Laser
    Effekt: One-Hit-Kill, durch Wand 1x
    Dauer: Instant

    Speed Boost
    Effekt: +50 % Bewegung
    Dauer: 3 Sek

    Shockwave
    Effekt: Alle Gegner vom Spieler weggeschubst
    Dauer: Instant

    Shield
    Effekt: Immunität gegen Schaden / Push
    Dauer: 3 Sek

    Gravity Pull / Magnet
    Effekt: Gegner zu dir gezogen
    Dauer: 2–3 Sek

    Random Teleport
    Effekt: Gegner irgendwo hin teleportiert
    Dauer: Instant

    Clone / Decoy
    Effekt: Temporärer Klon (verwirrt Gegner)
    Dauer: 3 Sek

    Invisibility
    Effekt: Unsichtbar für Gegner
    Dauer: 3 Sek (nur Umriss sichtbar)

    •	Spawn: zufällig, nur wenn Slot frei
    •	Cooldown: Arena-Spawn gesteuert (~5–10 Sek)

5️⃣ Rundenablauf 1. Spieler spawnen an sicheren Positionen 2. Countdown → Runde startet 3. Power-Ups fallen zufällig, Arena-Elemente aktiv 4. Spieler bewegen sich, kämpfen, blocken, manipulieren 5. Shrinking Arena + zentrale Power-Ups → Spieler ins Chaos gelockt 6. Letzter Spieler gewinnt → Punkte / Respawn → nächste Runde
