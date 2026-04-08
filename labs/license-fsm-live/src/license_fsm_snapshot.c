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

#define MAX_KEY_LEN 128
#define MAX_DECODED_BYTES 16

typedef struct LicenseState {
	uint8_t mode;
	uint8_t gate;
	uint8_t step_a;
	uint8_t step_b;
	uint32_t response;
	uint8_t checksum;
	char exec_action[16];
	char supplied_token[32];
	char supplied_receipt[32];
} LicenseState;

static const char LICENSE_ALPHABET[] = "Q4TJ8N2L6ZC7P9R5V1B3KXWMDHFGYAUE";
static const unsigned char SECRET_TOKEN_XOR[] = {
	'l' ^ 0x4d, 'i' ^ 0x4d, 'c' ^ 0x4d, '-' ^ 0x4d, 't' ^ 0x4d, 'o' ^ 0x4d,
	'k' ^ 0x4d, 'e' ^ 0x4d, 'n' ^ 0x4d, '-' ^ 0x4d, '1' ^ 0x4d, '7' ^ 0x4d,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x4d);
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
	snprintf(path, sizeof(path), "%s/license/license.log", runtime_dir);
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
	fprintf(file, "FLAG{license-fsm-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x7a7aUL);
	snprintf(path, sizeof(path), "%s/license/license.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/license/license.receipt", runtime_dir);
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

static int alphabet_index(char value) {
	const char *found = strchr(LICENSE_ALPHABET, value);
	if (found == NULL) {
		return -1;
	}
	return (int)(found - LICENSE_ALPHABET);
}

static size_t decode_license_key(const char *key, uint8_t *output, size_t capacity) {
	uint32_t bit_buffer = 0;
	unsigned int bits = 0;
	size_t written = 0;
	size_t index = 0;
	for (; key[index] != '\0'; index++) {
		int value = alphabet_index(key[index]);
		if (value < 0) {
			return 0;
		}
		bit_buffer = (bit_buffer << 5U) | (uint32_t)value;
		bits += 5U;
		while (bits >= 8U) {
			if (written >= capacity) {
				return 0;
			}
			bits -= 8U;
			output[written++] = (uint8_t)((bit_buffer >> bits) & 0xffU);
		}
	}
	return written;
}

static int load_auth(const char *license_dir, LicenseState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[128];

	snprintf(path, sizeof(path), "%s/auth.txt", license_dir);
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

static int load_license_key(const char *license_dir, char *output, size_t output_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	if (output_size == 0U) {
		return -1;
	}
	snprintf(path, sizeof(path), "%s/license.key", license_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	if (fgets(output, (int)output_size, file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(output);
	return 0;
}

static uint8_t compute_checksum(const uint8_t *decoded) {
	uint32_t total = 0;
	int index = 0;
	for (index = 0; index < 7; index++) {
		total += decoded[index];
	}
	return (uint8_t)((total ^ 0x5aU) & 0xffU);
}

static int parse_license(const char *license_dir, const char *runtime_dir, LicenseState *state, const char *secret_token) {
	char key[MAX_KEY_LEN];
	uint8_t decoded[MAX_DECODED_BYTES];
	size_t decoded_length = 0;
	uint32_t expected_response = rol32(hash_token(secret_token), 9U) ^ 0x71b4d2e9U;
	char line[256];

	if (load_license_key(license_dir, key, sizeof(key)) != 0) {
		return -1;
	}
	decoded_length = decode_license_key(key, decoded, sizeof(decoded));
	if (decoded_length < 8U) {
		return -1;
	}
	state->mode = decoded[0] & 0x0fU;
	state->gate = (decoded[0] >> 4U) & 0x0fU;
	state->step_a = decoded[1];
	state->step_b = decoded[2];
	state->response =
		(uint32_t)decoded[3] |
		((uint32_t)decoded[4] << 8U) |
		((uint32_t)decoded[5] << 16U) |
		((uint32_t)decoded[6] << 24U);
	state->checksum = decoded[7];
	snprintf(line, sizeof(line), "[license] mode=%u gate=%u step_a=%02x step_b=%02x response=%08x checksum=%02x",
		state->mode, state->gate, state->step_a, state->step_b, state->response, state->checksum);
	append_log_line(runtime_dir, line);
	if (compute_checksum(decoded) != state->checksum) {
		append_log_line(runtime_dir, "[license] checksum rejected");
		return 0;
	}
	if (state->mode == 3U && state->gate == 1U) {
		snprintf(state->exec_action, sizeof(state->exec_action), "%s", "");
	}
	if (state->mode == 7U &&
		state->gate == 13U &&
		state->step_a == 0x42U &&
		state->step_b == 0x99U &&
		state->response == expected_response) {
		snprintf(state->exec_action, sizeof(state->exec_action), "%s", "root_license");
	}
	return 0;
}

int main(int argc, char **argv) {
	const char *license_dir = NULL;
	const char *runtime_dir = "./runtime";
	LicenseState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	memset(&state, 0, sizeof(state));
	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--license") == 0 && index + 1 < argc) {
			license_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (license_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/license", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	load_auth(license_dir, &state);
	if (parse_license(license_dir, runtime_dir, &state, secret_token) != 0) {
		append_log_line(runtime_dir, "[license] failed to parse key");
		return 1;
	}
	append_log_line(runtime_dir, "[license] verification complete");
	snprintf(line, sizeof(line), "[license] exec_action=%s", state.exec_action[0] != '\0' ? state.exec_action : "(none)");
	append_log_line(runtime_dir, line);
	if (state.mode == 3U && state.gate == 1U) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[license] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[license] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.exec_action, "root_license") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_license created proof artifact");
		printf("license proof completed successfully\n");
		return 0;
	}
	if (strcmp(state.exec_action, "root_license") == 0) {
		append_log_line(runtime_dir, "[license] root_license rejected: missing token or receipt");
	}
	printf("license verification completed without privileged proof\n");
	return 0;
}
