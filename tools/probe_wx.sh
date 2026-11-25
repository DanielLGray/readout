#!/bin/bash
# Temporary: does api.weather.gov answer a web page (CORS), and what is Reno's forecast grid?
UA="readout (github.com/DanielLGray/readout)"
echo "== points"; curl -s -D - -H "User-Agent: $UA" -H "Origin: https://daniellgray.github.io" "https://api.weather.gov/points/39.5296,-119.8138" -o /tmp/p.json | grep -iE "^HTTP|access-control|cache-control|content-type"
python3 -c "import json; p=json.load(open('/tmp/p.json'))['properties']; print(p['forecast'], p['gridId'], p['gridX'], p['gridY'], p['timeZone'], p['relativeLocation']['properties'])"
F=$(python3 -c "import json; print(json.load(open('/tmp/p.json'))['properties']['forecast'])")
echo "== forecast (preflight-free GET with Origin)"; curl -s -D - -H "Origin: https://daniellgray.github.io" "$F" -o /tmp/f.json | grep -iE "^HTTP|access-control|cache-control|expires"
python3 -c "
import json; d=json.load(open('/tmp/f.json'))['properties']
print('updated', d.get('updateTime'), 'generated', d.get('generatedAt'))
for p in d['periods'][:5]: print(p['name'], p['startTime'], p['isDaytime'], p['temperature'], p['temperatureUnit'], '|', p['shortForecast'], '| pop', (p.get('probabilityOfPrecipitation') or {}).get('value'), '|', p['icon'])
print(len(open('/tmp/f.json').read()), 'bytes')"
echo "== without a User-Agent (as a browser sends its own)"; curl -s -o /dev/null -w "%{http_code}\n" -A "" "$F"
