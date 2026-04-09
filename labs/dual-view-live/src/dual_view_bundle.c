#define _POSIX_C_SOURCE 200809L

#include "dual_view_types.h"

#include <ctype.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int dual_parse_u32_hex(const char *text, uint32_t *value) {
	char *endptr = NULL;
	unsigned long parsed = strtoul(text, &endptr, 16);
	if (endptr == text || *endptr != '\0' || parsed > 0xffffffffUL) {
		return -1;
	}
	*value = (uint32_t)parsed;
	return 0;
}

static int dual_parse_request(const char *bundle_dir, DualBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];

	snprintf(path, sizeof(path), "%s/request.ini", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *sep = strchr(line, '=');
		char *value = NULL;
		dual_trim_line(line);
		if (sep == NULL) {
			continue;
		}
		*sep = '\0';
		value = sep + 1;
		if (strcmp(line, "mode") == 0) {
			snprintf(bundle->mode, sizeof(bundle->mode), "%s", value);
		} else if (strcmp(line, "profile") == 0) {
			snprintf(bundle->profile, sizeof(bundle->profile), "%s", value);
		} else if (strcmp(line, "width") == 0) {
			if (dual_parse_u32_hex(value, &bundle->width) != 0) {
				fclose(file);
				return -1;
			}
		} else if (strcmp(line, "response") == 0) {
			if (dual_parse_u32_hex(value, &bundle->response) != 0) {
				fclose(file);
				return -1;
			}
		}
	}
	fclose(file);
	return 0;
}

static int dual_parse_rows(const char *path, DualRow *rows, size_t *count) {
	FILE *file = NULL;
	char line[256];

	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char name[16];
		char left_text[32];
		char right_text[32];
		size_t index = 0;
		if (*count >= DUAL_MAX_ROWS) {
			fclose(file);
			return -1;
		}
		if (line[0] == '#' || line[0] == '\n') {
			continue;
		}
		if (sscanf(line, "%15s %31s %31s", name, left_text, right_text) != 3) {
			fclose(file);
			return -1;
		}
		for (; name[index] != '\0'; index++) {
			if (!isalpha((unsigned char)name[index])) {
				fclose(file);
				return -1;
			}
		}
		snprintf(rows[*count].name, sizeof(rows[*count].name), "%s", name);
		if (dual_parse_u32_hex(left_text, &rows[*count].left) != 0 ||
			dual_parse_u32_hex(right_text, &rows[*count].right) != 0) {
			fclose(file);
			return -1;
		}
		*count += 1U;
	}
	fclose(file);
	return 0;
}

int dual_parse_bundle(const char *bundle_dir, DualBundle *bundle) {
	char path[PATH_MAX];
	memset(bundle, 0, sizeof(*bundle));
	if (dual_parse_request(bundle_dir, bundle) != 0) {
		return -1;
	}
	snprintf(path, sizeof(path), "%s/primary.tbl", bundle_dir);
	if (dual_parse_rows(path, bundle->primary, &bundle->primary_count) != 0) {
		return -1;
	}
	snprintf(path, sizeof(path), "%s/shadow.tbl", bundle_dir);
	if (dual_parse_rows(path, bundle->shadow, &bundle->shadow_count) != 0) {
		return -1;
	}
	return dual_load_auth(bundle_dir, bundle);
}
