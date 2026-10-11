INSERT INTO "games" ("slug", "name") VALUES
	('valorant', 'VALORANT'),
	('league-of-legends', 'League of Legends'),
	('counter-strike-2', 'Counter-Strike 2')
ON CONFLICT ("slug") DO NOTHING;
