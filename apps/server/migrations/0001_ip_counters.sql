CREATE TABLE `ip_counters` (
	`key` text NOT NULL,
	`win` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`key`, `win`)
);
