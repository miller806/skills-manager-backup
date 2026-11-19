---
name: home-and-location
description: "Smart home control (Philips Hue) and geolocation (OpenStreetMap/OSRM)."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [smart-home, Hue, geocoding, maps, routing, OpenStreetMap]
    related_skills: [cron-information-gathering]
---

# Home & Location

Umbrella for smart home control and geolocation services.

---

## Philips Hue (openhue)

Control Philips Hue lights, scenes, and rooms via CLI.

```bash
openhue lights                    # List all lights
openhue lights <id> on            # Turn on
openhue lights <id> off           # Turn off
openhue lights <id> --brightness 50  # Set brightness
openhue lights <id> --color red   # Set color
openhue scenes                    # List scenes
openhue scenes <name>             # Activate scene
openhue rooms                     # List rooms
openhue rooms <name> on           # Turn on all lights in room
```

Use for: turning lights on/off, setting brightness/color, activating scenes, room-level control.

---

## Maps & Geocoding (maps)

Geocode addresses, find POIs, calculate routes, and get timezone info via OpenStreetMap/OSRM.

**Geocoding:**
```bash
# Address → coordinates
curl -s "https://nominatim.openstreetmap.org/search?q=1600+Amphitheatre+Parkway&format=json&limit=1"

# Coordinates → address (reverse geocoding)
curl -s "https://nominatim.openstreetmap.org/reverse?lat=37.422&lon=-122.084&format=json"
```

**Routing:**
```bash
# OSRM routing
curl -s "http://router.project-osrm.org/route/v1/driving/-122.084,37.422;-122.419,37.774?overview=full&geometries=json"
```

**Timezone:**
```bash
curl -s "http://api.timezonedb.com/v1.1/time-zone?key=API_KEY&format=json&by=position&lat=37.422&lng=-122.084"
```

Use for: address lookup, finding nearby places, route planning, timezone lookup.
