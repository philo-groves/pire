#define _POSIX_C_SOURCE 200809L

#include "ledger_lock_types.h"

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const unsigned char SECRET_TOKEN_XOR[] = {
	'l' ^ 0x36, 'e' ^ 0x36, 'd' ^ 0x36, 'g' ^ 0x36, 'e' ^ 0x36, 'r' ^ 0x36, '-' ^ 0x36,
	't' ^ 0x36, 'o' ^ 0x36, 'k' ^ 0x36, 'e' ^ 0x36, 'n' ^ 0x36, '-' ^ 0x36, '5' ^ 0x36, '8' ^ 0x36,
};

char *ledger_trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

uint32_t ledger_rol32(uint32_t value, unsigned int shift) {
	shift &= 31U;
	if (shift == 0U) {
		return value;
	}
	return (value << shift) | (value >> (32U - shift));
}

uint32_t ledger_hash_token(const char *token) {
	uint32_t hash = 0x811c9dc5U;
	size_t index = 0;
	for (; token[index] != '\0'; index++) {
		hash ^= (unsigned char)token[index];
		hash *= 0x01000193U;
	}
	return hash;
}

void ledger_decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	const size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x36);
	}
	output[index] = '\0';
}

int ledger_ensure_dir(const char *path) {
	if (mkdir(path, 0755) == 0 || errno == EEXIST) {
		return 0;
	}
	perror(path);
	return -1;
}

int ledger_append_log_line(const char *runtime_dir, const char *line) {
	char path[PATH_MAX];
	FILE *log_file = NULL;
	snprintf(path, sizeof(path), "%s/ledger/ledger.log", runtime_dir);
	log_file = fopen(path, "a");
	if (log_file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(log_file, "%s\n", line);
	fclose(log_file);
	return 0;
}

int ledger_write_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/root/root_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{ledger-lock-live}\n");
	fclose(file);
	return 0;
}

int ledger_save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", ((unsigned long)getpid() << 5U) ^ 0x58c3UL);
	snprintf(path, sizeof(path), "%s/ledger/ledger.receipt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", receipt);
	fclose(file);
	return 0;
}

int ledger_load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/ledger/ledger.receipt", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(receipt, (int)receipt_size, file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	ledger_trim_line(receipt);
	return 0;
}

int ledger_load_auth(const char *bundle_dir, LedgerBundle *bundle) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[128];

	snprintf(path, sizeof(path), "%s/auth.txt", bundle_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return 0;
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
		if (strcmp(line, "token") == 0) {
			snprintf(bundle->supplied_token, sizeof(bundle->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(bundle->supplied_receipt, sizeof(bundle->supplied_receipt), "%s", value);
		}
	}
	fclose(file);
	return 0;
}
