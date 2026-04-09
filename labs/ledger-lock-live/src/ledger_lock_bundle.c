#define _POSIX_C_SOURCE 200809L

#include "ledger_lock_types.h"

#include <ctype.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int ledger_parse_u32_hex(const char *text, uint32_t *value) {
	char *endptr = NULL;
	unsigned long parsed = strtoul(text, &endptr, 16);
	if (endptr == text || *endptr != '\0' || parsed > 0xffffffffUL) {
		return -1;
	}
	*value = (uint32_t)parsed;
	return 0;
}

static int ledger_parse_name(const char *name) {
	size_t index = 0;
	for (; name[index] != '\0'; index++) {
		if (!isalpha((unsigned char)name[index])) {
			return -1;
		}
	}
	return 0;
}

static int ledger_parse_request(const char *bundle_dir, LedgerBundle *bundle) {
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
		ledger_trim_line(line);
		if (sep == NULL) {
			continue;
		}
		*sep = '\0';
		value = sep + 1;
		if (strcmp(line, "mode") == 0) {
			snprintf(bundle->mode, sizeof(bundle->mode), "%s", value);
		} else if (strcmp(line, "phase") == 0) {
			snprintf(bundle->phase, sizeof(bundle->phase), "%s", value);
		} else if (strcmp(line, "window") == 0) {
			if (ledger_parse_u32_hex(value, &bundle->window) != 0) {
				fclose(file);
				return -1;
			}
		} else if (strcmp(line, "response") == 0) {
			if (ledger_parse_u32_hex(value, &bundle->response) != 0) {
				fclose(file);
				return -1;
			}
		}
	}
	fclose(file);
	return 0;
}

static int ledger_parse_accounts(const char *bundle_dir, LedgerBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	snprintf(path, sizeof(path), "%s/accounts.tbl", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char name[16];
		char value_text[32];
		char tag_text[32];
		if (bundle->account_count >= LEDGER_MAX_ROWS) {
			fclose(file);
			return -1;
		}
		if (line[0] == '#' || line[0] == '\n') {
			continue;
		}
		if (sscanf(line, "%15s %31s %31s", name, value_text, tag_text) != 3 || ledger_parse_name(name) != 0) {
			fclose(file);
			return -1;
		}
		snprintf(bundle->accounts[bundle->account_count].name, sizeof(bundle->accounts[bundle->account_count].name), "%s", name);
		if (
			ledger_parse_u32_hex(value_text, &bundle->accounts[bundle->account_count].value) != 0 ||
			ledger_parse_u32_hex(tag_text, &bundle->accounts[bundle->account_count].tag) != 0
		) {
			fclose(file);
			return -1;
		}
		bundle->account_count += 1U;
	}
	fclose(file);
	return 0;
}

static int ledger_parse_links(const char *bundle_dir, LedgerBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	snprintf(path, sizeof(path), "%s/links.tbl", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char from[16];
		char to[16];
		char weight_text[32];
		if (bundle->link_count >= LEDGER_MAX_ROWS) {
			fclose(file);
			return -1;
		}
		if (line[0] == '#' || line[0] == '\n') {
			continue;
		}
		if (sscanf(line, "%15s %15s %31s", from, to, weight_text) != 3 || ledger_parse_name(from) != 0 || ledger_parse_name(to) != 0) {
			fclose(file);
			return -1;
		}
		snprintf(bundle->links[bundle->link_count].from, sizeof(bundle->links[bundle->link_count].from), "%s", from);
		snprintf(bundle->links[bundle->link_count].to, sizeof(bundle->links[bundle->link_count].to), "%s", to);
		if (ledger_parse_u32_hex(weight_text, &bundle->links[bundle->link_count].weight) != 0) {
			fclose(file);
			return -1;
		}
		bundle->link_count += 1U;
	}
	fclose(file);
	return 0;
}

static int ledger_parse_steps(const char *bundle_dir, LedgerBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	snprintf(path, sizeof(path), "%s/journal.seq", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char name[16];
		char op[8];
		char adjust_text[32];
		if (bundle->step_count >= LEDGER_MAX_ROWS) {
			fclose(file);
			return -1;
		}
		if (line[0] == '#' || line[0] == '\n') {
			continue;
		}
		if (sscanf(line, "%15s %7s %31s", name, op, adjust_text) != 3 || ledger_parse_name(name) != 0) {
			fclose(file);
			return -1;
		}
		snprintf(bundle->steps[bundle->step_count].name, sizeof(bundle->steps[bundle->step_count].name), "%s", name);
		snprintf(bundle->steps[bundle->step_count].op, sizeof(bundle->steps[bundle->step_count].op), "%s", op);
		if (ledger_parse_u32_hex(adjust_text, &bundle->steps[bundle->step_count].adjust) != 0) {
			fclose(file);
			return -1;
		}
		bundle->step_count += 1U;
	}
	fclose(file);
	return 0;
}

int ledger_parse_bundle(const char *bundle_dir, LedgerBundle *bundle) {
	memset(bundle, 0, sizeof(*bundle));
	if (ledger_parse_request(bundle_dir, bundle) != 0) {
		return -1;
	}
	if (ledger_parse_accounts(bundle_dir, bundle) != 0) {
		return -1;
	}
	if (ledger_parse_links(bundle_dir, bundle) != 0) {
		return -1;
	}
	if (ledger_parse_steps(bundle_dir, bundle) != 0) {
		return -1;
	}
	return ledger_load_auth(bundle_dir, bundle);
}
