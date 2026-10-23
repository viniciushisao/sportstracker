# Official university schedule fixtures

Public HTML downloaded October 23, 2026, without credentials; compressed with gzip.
These are complete grid schedule pages, not hand-authored sample games.

- `uoft-men.html.gz`: https://varsityblues.ca/sports/mens-volleyball/schedule/2026-27?grid=true
- `uoft-women.html.gz`: https://varsityblues.ca/sports/womens-volleyball/schedule/2026-27?grid=true
- `tmu-men.html.gz`: https://tmubold.ca/sports/mens-volleyball/schedule/2026-27?grid=true
- `tmu-women.html.gz`: https://tmubold.ca/sports/womens-volleyball/schedule/2026-27?grid=true

The visible table is authoritative for Home/Away/Neutral. Embedded JSON-LD was
observed to label the publishing school's team as `homeTeam` even on away games;
it must not be used to decide whether a game is at home.

Venue addresses verified against official facility pages on the same date:

- Goldring Centre, 100 Devonshire Place, Toronto:
  https://varsityblues.ca/sports/2015/5/19/GEN_0519151632.aspx?path=cross
- Mattamy Athletic Centre, Home Court, 50 Carlton Street, Toronto:
  https://tmubold.ca/sports/2021/8/5/map-and-directions-mattamy-athletic-centre.aspx

Rows naming Ontario University Athletics or U SPORTS Championship are conditional
round/event placeholders, not confirmed matchups. Tests exclude those rows.
