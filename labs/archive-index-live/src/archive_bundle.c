#define _POSIX_C_SOURCE 200809L

#include "archive_types.h"

#include <ctype.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int archive_parse_u32_hex(const char *text, uint32_t *value) {
	char *endptr = NULL;
	unsigned long parsed = strtoul(text, &endptr, 16);
	if (endptr == text || *endptr != '\0' || parsed > 0xffffffffUL) {
		return -1;
	}
	*value = (uint32_t)parsed;
	return 0;
}

static int archive_parse_manifest(const char *bundle_dir, ArchiveBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];

	snprintf(path, sizeof(path), "%s/manifest.ini", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *sep = strchr(line, '=');
		char *value = NULL;
		archive_trim_line(line);
		if (sep == NULL) {
			continue;
		}
		*sep = '\0';
		value = sep + 1;
		if (strcmp(line, "mode") == 0) {
			snprintf(bundle->mode, sizeof(bundle->mode), "%s", value);
		} else if (strcmp(line, "profile") == 0) {
			snprintf(bundle->profile, sizeof(bundle->profile), "%s", value);
		} else if (strcmp(line, "span") == 0) {
			if (archive_parse_u32_hex(value, &bundle->span) != 0) {
				fclose(file);
				return -1;
			}
		} else if (strcmp(line, "bias") == 0) {
			if (archive_parse_u32_hex(value, &bundle->bias) != 0) {
				fclose(file);
				return -1;
			}
		} else if (strcmp(line, "response") == 0) {
			if (archive_parse_u32_hex(value, &bundle->response) != 0) {
				fclose(file);
				return -1;
			}
		}
	}
	fclose(file);
	return 0;
}

static int archive_parse_sections(const char *bundle_dir, ArchiveBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];

	snprintf(path, sizeof(path), "%s/sections.tbl", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char name[16];
		char base_text[32];
		char delta_text[32];
		if (bundle->section_count >= ARCHIVE_MAX_SECTIONS) {
			fclose(file);
			return -1;
		}
		if (line[0] == '#' || line[0] == '\n') {
			continue;
		}
		if (sscanf(line, "%15s %31s %31s", name, base_text, delta_text) != 3) {
			fclose(file);
			return -1;
		}
		for (size_t index = 0; name[index] != '\0'; index++) {
			if (!isalpha((unsigned char)name[index])) {
				fclose(file);
				return -1;
			}
		}
		snprintf(bundle->sections[bundle->section_count].name, sizeof(bundle->sections[bundle->section_count].name), "%s", name);
		if (archive_parse_u32_hex(base_text, &bundle->sections[bundle->section_count].base) != 0 ||
			archive_parse_u32_hex(delta_text, &bundle->sections[bundle->section_count].delta) != 0) {
			fclose(file);
			return -1;
		}
		bundle->section_count += 1U;
	}
	fclose(file);
	return 0;
}

int archive_parse_bundle(const char *bundle_dir, ArchiveBundle *bundle) {
	memset(bundle, 0, sizeof(*bundle));
	if (archive_parse_manifest(bundle_dir, bundle) != 0) {
		return -1;
	}
	if (archive_parse_sections(bundle_dir, bundle) != 0) {
		return -1;
	}
	return archive_load_auth(bundle_dir, bundle);
}
