"""Tests read the settings files as written: changes made in the app (config/overrides.json) are left out."""
import os

os.environ.setdefault("READOUT_OVERRIDES", "off")
