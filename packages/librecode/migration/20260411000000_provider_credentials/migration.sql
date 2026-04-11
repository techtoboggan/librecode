CREATE TABLE `provider_credentials` (
  `provider_id` text PRIMARY KEY NOT NULL,
  `url` text,
  `api_key` text,
  `metadata` text DEFAULT '{}' NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
