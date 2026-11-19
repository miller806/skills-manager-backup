---
name: ascii-tools
description: "ASCII art and ASCII video: text-based art generation from text, images, and video/audio."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [ASCII, art, video, pyfiglet, cowsay, text-art, animation]
    related_skills: [vision_analyze]
---

# ASCII Tools

Umbrella for ASCII art generation and ASCII video conversion.

---

## ASCII Art

Generate ASCII art from text, images, or using decorative boxes.

### Text to ASCII art (pyfiglet)
```bash
pyfiglet "Hello World"           # Default font
pyfiglet -f slant "Hello"        # Specific font
pyfiglet -l                      # List available fonts
```

### Cowsay and boxes
```bash
cowsay "Hello"                   # Classic cowsay
cowsay -f dragon "Hello"         # Different character
boxes -d peek -a c file.txt      # Decorative box around text
boxes -l                         # List available designs
```

### Image to ASCII
Convert images to ASCII art using image-to-ascii tools:
```bash
# Convert image to ASCII
img2txt -W 80 -H 40 image.png    # libcaca
# Or use Python-based converters with vision_analyze for preview
```

---

## ASCII Video

Convert video or audio files to colored ASCII animation (MP4/GIF output).

Use for creating stylized ASCII/ANSI animations from existing video or audio content. Outputs can be MP4 or GIF format with color preservation.
