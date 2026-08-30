---
title: "{{ replace .Name "-" " " | title }}"
date: {{ .Date }}
audio: ""              # Leave empty to auto-use {{ .Name }}.mp3
audio_url: ""          # Public URL to hosted audio (R2). Preferred over local audio.
model: "s2.1-pro"       # one of: s2.1-pro, s2-pro, s1, drama-3
language: "en"
tags: []
contributor: ""        # Submitter name/handle
source_issue: 0        # GitHub issue this prompt came from
voice_name: ""         # optional: display name of the Fish Audio voice, e.g. "Documentary Narrator Voice"
voice_url: ""          # optional: link to Fish Audio voice, e.g. "https://fish.audio/m/06363c7577df4390aea3e466224a542d"
metadata:
  prompt_text: |
    [calm] Describe the voice prompt here.
    [curious] Use multilines for clear view — each bracketed emotion on its own line.
  # All fields below are optional — N/A in UI when omitted
  speed: 1.0                # 0.7 to 1.3
  volume: 0                 # -5 to 5
  temperature: 0.7          # lower = more deterministic
  top_p: 0.7
  repetition_penalty: 1.2   # >1.0 curbs repeated sounds
  nsfw: false
---

Add a description or additional notes about this prompt here.
