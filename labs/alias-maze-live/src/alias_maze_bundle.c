#define _POSIX_C_SOURCE 200809L

#include "alias_maze_types.h"

#include <ctype.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int maze_parse_u32_hex(const char *text, uint32_t *value) {
	char *endptr = NULL;
	unsigned long parsed = strtoul(text, &endptr, 16);
	if (endptr == text || *endptr != '\0' || parsed > 0xffffffffUL) {
		return -1;
	}
	*value = (uint32_t)parsed;
	return 0;
}

static int maze_parse_request(const char *bundle_dir, MazeBundle *bundle) {
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
		maze_trim_line(line);
		if (sep == NULL) {
			continue;
		}
		*sep = '\0';
		value = sep + 1;
		if (strcmp(line, "mode") == 0) {
			snprintf(bundle->mode, sizeof(bundle->mode), "%s", value);
		} else if (strcmp(line, "window") == 0) {
			if (maze_parse_u32_hex(value, &bundle->window) != 0) {
				fclose(file);
				return -1;
			}
		} else if (strcmp(line, "response") == 0) {
			if (maze_parse_u32_hex(value, &bundle->response) != 0) {
				fclose(file);
				return -1;
			}
		}
	}
	fclose(file);
	return 0;
}

static int maze_parse_bases(const char *bundle_dir, MazeBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];

	snprintf(path, sizeof(path), "%s/base.tbl", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char name[16];
		char value_text[32];
		char class_text[32];
		size_t index = 0;
		if (bundle->base_count >= MAZE_MAX_BASES) {
			fclose(file);
			return -1;
		}
		if (line[0] == '#' || line[0] == '\n') {
			continue;
		}
		if (sscanf(line, "%15s %31s %31s", name, value_text, class_text) != 3) {
			fclose(file);
			return -1;
		}
		for (; name[index] != '\0'; index++) {
			if (!isalpha((unsigned char)name[index])) {
				fclose(file);
				return -1;
			}
		}
		snprintf(bundle->bases[bundle->base_count].name, sizeof(bundle->bases[bundle->base_count].name), "%s", name);
		if (maze_parse_u32_hex(value_text, &bundle->bases[bundle->base_count].value) != 0 ||
			maze_parse_u32_hex(class_text, &bundle->bases[bundle->base_count].class_tag) != 0) {
			fclose(file);
			return -1;
		}
		bundle->base_count += 1U;
	}
	fclose(file);
	return 0;
}

static int maze_parse_aliases(const char *bundle_dir, MazeBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	snprintf(path, sizeof(path), "%s/aliases.tbl", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char alias[16];
		char target[16];
		if (bundle->alias_count >= MAZE_MAX_ALIASES) {
			fclose(file);
			return -1;
		}
		if (line[0] == '#' || line[0] == '\n') {
			continue;
		}
		if (sscanf(line, "%15s %15s", alias, target) != 2) {
			fclose(file);
			return -1;
		}
		snprintf(bundle->aliases[bundle->alias_count].alias, sizeof(bundle->aliases[bundle->alias_count].alias), "%s", alias);
		snprintf(bundle->aliases[bundle->alias_count].target, sizeof(bundle->aliases[bundle->alias_count].target), "%s", target);
		bundle->alias_count += 1U;
	}
	fclose(file);
	return 0;
}

static int maze_parse_steps(const char *bundle_dir, MazeBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];

	snprintf(path, sizeof(path), "%s/plan.seq", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char alias[16];
		char op[8];
		char adjust_text[32];
		if (bundle->step_count >= MAZE_MAX_STEPS) {
			fclose(file);
			return -1;
		}
		if (line[0] == '#' || line[0] == '\n') {
			continue;
		}
		if (sscanf(line, "%15s %7s %31s", alias, op, adjust_text) != 3) {
			fclose(file);
			return -1;
		}
		snprintf(bundle->steps[bundle->step_count].alias, sizeof(bundle->steps[bundle->step_count].alias), "%s", alias);
		snprintf(bundle->steps[bundle->step_count].op, sizeof(bundle->steps[bundle->step_count].op), "%s", op);
		if (maze_parse_u32_hex(adjust_text, &bundle->steps[bundle->step_count].adjust) != 0) {
			fclose(file);
			return -1;
		}
		bundle->step_count += 1U;
	}
	fclose(file);
	return 0;
}

int maze_parse_bundle(const char *bundle_dir, MazeBundle *bundle) {
	memset(bundle, 0, sizeof(*bundle));
	if (maze_parse_request(bundle_dir, bundle) != 0) {
		return -1;
	}
	if (maze_parse_bases(bundle_dir, bundle) != 0) {
		return -1;
	}
	if (maze_parse_aliases(bundle_dir, bundle) != 0) {
		return -1;
	}
	if (maze_parse_steps(bundle_dir, bundle) != 0) {
		return -1;
	}
	return maze_load_auth(bundle_dir, bundle);
}
