#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct RelocState {
	uint32_t slots[4];
	uint32_t checksum;
	int debug;
	char exec_action[16];
	char supplied_token[32];
	char supplied_receipt[32];
} RelocState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'r' ^ 0x29, 'e' ^ 0x29, 'l' ^ 0x29, 'o' ^ 0x29, 'c' ^ 0x29, '-' ^ 0x29,
	't' ^ 0x29, 'o' ^ 0x29, 'k' ^ 0x29, 'e' ^ 0x29, 'n' ^ 0x29, '-' ^ 0x29,
	'9' ^ 0x29,
};

static char *trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

static uint32_t rol32(uint32_t value, unsigned int shift) {
	shift &= 31U;
	if (shift == 0U) {
		return value;
	}
	return (value << shift) | (value >> (32U - shift));
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x29);
	}
	output[index] = '\0';
}

static uint32_t hash_token(const char *token) {
	uint32_t hash = 0x811c9dc5U;
	size_t index = 0;
	for (; token[index] != '\0'; index++) {
		hash ^= (unsigned char)token[index];
		hash *= 0x01000193U;
	}
	return hash;
}

static int ensure_dir(const char *path) {
	if (mkdir(path, 0755) == 0 || errno == EEXIST) {
		return 0;
	}
	perror(path);
	return -1;
}

static int append_log_line(const char *runtime_dir, const char *line) {
	char path[PATH_MAX];
	FILE *log_file = NULL;
	snprintf(path, sizeof(path), "%s/loader/loader.log", runtime_dir);
	log_file = fopen(path, "a");
	if (log_file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(log_file, "%s\n", line);
	fclose(log_file);
	return 0;
}

static int write_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/root/root_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{reloc-record-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x6c6cUL);
	snprintf(path, sizeof(path), "%s/loader/loader.receipt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", receipt);
	fclose(file);
	return 0;
}

static int load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/loader/loader.receipt", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(receipt, (int)receipt_size, file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(receipt);
	return 0;
}

static int load_auth(const char *records_dir, RelocState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[128];

	snprintf(path, sizeof(path), "%s/auth.txt", records_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return 0;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *sep = NULL;
		char *value = NULL;
		trim_line(line);
		sep = strchr(line, '=');
		if (sep == NULL) {
			continue;
		}
		*sep = '\0';
		value = sep + 1;
		if (strcmp(line, "token") == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", value);
		}
	}
	fclose(file);
	return 0;
}

static uint32_t decode_word(uint32_t raw, size_t index) {
	return raw ^ (0x13579bdfU + (uint32_t)index * 0x01020304U);
}

static int process_records(const char *records_dir, const char *runtime_dir, RelocState *state, const char *secret_token) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	size_t index = 0;
	uint32_t hash = hash_token(secret_token);
	uint32_t expected0 = rol32(hash ^ 0x44aa1199U, 7U);
	uint32_t expected1 = (hash + 0x10293847U) ^ 0x55aa55aaU;
	uint32_t expected2 = rol32(hash, 13U) ^ 0xc0dec0deU;

	snprintf(path, sizeof(path), "%s/records.txt", records_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *endptr = NULL;
		uint32_t raw = 0;
		uint32_t decoded = 0;
		uint32_t tag = 0;
		uint32_t field_a = 0;
		uint32_t field_b = 0;
		uint32_t field_c = 0;
		char log_line[256];

		trim_line(line);
		if (line[0] == '\0') {
			continue;
		}
		raw = (uint32_t)strtoul(line, &endptr, 16);
		if (endptr == line || *endptr != '\0') {
			fclose(file);
			return -1;
		}
		decoded = decode_word(raw, index++);
		tag = (decoded >> 28U) & 0xfU;
		field_a = (decoded >> 20U) & 0xffU;
		field_b = (decoded >> 12U) & 0xffU;
		field_c = decoded & 0xfffU;
		snprintf(log_line, sizeof(log_line), "[loader] tag=%x a=%02x b=%02x c=%03x", tag, field_a, field_b, field_c);
		append_log_line(runtime_dir, log_line);
		switch (tag) {
			case 0x1:
				state->slots[field_a & 3U] = (field_b << 12U) | field_c;
				break;
			case 0x2:
				state->slots[field_a & 3U] ^= (field_b << 12U) | field_c;
				break;
			case 0x3:
				state->checksum += decoded ^ 0x55aa33ccU;
				break;
			case 0x4:
				state->slots[field_a & 3U] = rol32(state->slots[field_a & 3U], field_c & 31U);
				break;
			case 0x5:
				state->slots[field_a & 3U] =
					rol32(state->slots[field_a & 3U] + state->slots[field_b & 3U] + field_c, (field_a + field_b + field_c) & 31U);
				break;
			case 0x9:
				state->debug = 1;
				break;
			case 0xd:
				if (state->slots[0] == expected0 &&
					state->slots[1] == expected1 &&
					((state->checksum ^ state->slots[2]) == expected2)) {
					snprintf(state->exec_action, sizeof(state->exec_action), "%s", "root_reloc");
				}
				break;
			default:
				break;
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *records_dir = NULL;
	const char *runtime_dir = "./runtime";
	RelocState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	memset(&state, 0, sizeof(state));
	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--records") == 0 && index + 1 < argc) {
			records_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (records_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/loader", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	load_auth(records_dir, &state);
	if (process_records(records_dir, runtime_dir, &state, secret_token) != 0) {
		append_log_line(runtime_dir, "[loader] failed to process records");
		return 1;
	}
	append_log_line(runtime_dir, "[loader] processing complete");
	snprintf(line, sizeof(line), "[loader] slots=%08x,%08x,%08x,%08x checksum=%08x action=%s",
		state.slots[0], state.slots[1], state.slots[2], state.slots[3], state.checksum,
		state.exec_action[0] != '\0' ? state.exec_action : "(none)");
	append_log_line(runtime_dir, line);
	if (state.debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[loader] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[loader] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.exec_action, "root_reloc") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_reloc created proof artifact");
		printf("reloc proof completed successfully\n");
		return 0;
	}
	if (strcmp(state.exec_action, "root_reloc") == 0) {
		append_log_line(runtime_dir, "[loader] root_reloc rejected: missing token or receipt");
	}
	printf("reloc processing completed without privileged proof\n");
	return 0;
}
