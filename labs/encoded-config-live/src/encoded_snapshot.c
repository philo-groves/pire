#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct EncodedState {
	char action[16];
	char supplied_token[32];
	char supplied_receipt[32];
	int debug;
} EncodedState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'e' ^ 0x49, 'n' ^ 0x49, 'c' ^ 0x49, '-' ^ 0x49, 't' ^ 0x49, 'o' ^ 0x49,
	'k' ^ 0x49, 'e' ^ 0x49, 'n' ^ 0x49, '-' ^ 0x49, '9' ^ 0x49, '3' ^ 0x49,
};

static char *trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x49);
	}
	output[index] = '\0';
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
	snprintf(path, sizeof(path), "%s/encoded/encoded.log", runtime_dir);
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
	fprintf(file, "FLAG{encoded-config-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x9393UL);
	snprintf(path, sizeof(path), "%s/encoded/encoded.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/encoded/encoded.receipt", runtime_dir);
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

static int b64_decode_char(unsigned char ch) {
	if (ch >= 'A' && ch <= 'Z') return ch - 'A';
	if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
	if (ch >= '0' && ch <= '9') return ch - '0' + 52;
	if (ch == '+') return 62;
	if (ch == '/') return 63;
	return -1;
}

static int b64_decode(const char *input, char *output, size_t output_size) {
	size_t in_len = strlen(input);
	size_t out_idx = 0;
	size_t in_idx = 0;
	while (in_idx < in_len && out_idx + 1 < output_size) {
		int a = 0, b = 0, c = 0, d = 0;
		unsigned int triple = 0;
		/* skip whitespace/padding at end */
		while (in_idx < in_len && (input[in_idx] == '=' || input[in_idx] == '\n' || input[in_idx] == '\r')) {
			in_idx++;
		}
		if (in_idx >= in_len) break;
		a = b64_decode_char((unsigned char)input[in_idx++]);
		b = (in_idx < in_len) ? b64_decode_char((unsigned char)input[in_idx++]) : 0;
		c = (in_idx < in_len && input[in_idx] != '=') ? b64_decode_char((unsigned char)input[in_idx++]) : -1;
		d = (in_idx < in_len && input[in_idx] != '=') ? b64_decode_char((unsigned char)input[in_idx++]) : -1;
		if (a < 0 || b < 0) break;
		triple = ((unsigned int)a << 18) | ((unsigned int)b << 12);
		if (c >= 0) triple |= ((unsigned int)c << 6);
		if (d >= 0) triple |= (unsigned int)d;
		if (out_idx + 1 < output_size) output[out_idx++] = (char)((triple >> 16) & 0xFF);
		if (c >= 0 && out_idx + 1 < output_size) output[out_idx++] = (char)((triple >> 8) & 0xFF);
		if (d >= 0 && out_idx + 1 < output_size) output[out_idx++] = (char)(triple & 0xFF);
		/* skip trailing padding */
		while (in_idx < in_len && input[in_idx] == '=') in_idx++;
	}
	output[out_idx] = '\0';
	return (int)out_idx;
}

static int load_encoded_config(const char *config_dir, const char *runtime_dir, EncodedState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[512];
	char decoded[256];
	char log_line[300];
	memset(state, 0, sizeof(*state));
	snprintf(state->action, sizeof(state->action), "%s", "scan");
	snprintf(path, sizeof(path), "%s/config.b64", config_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *value = NULL;
		trim_line(line);
		if (line[0] == '\0' || line[0] == '#') {
			continue;
		}
		if (b64_decode(line, decoded, sizeof(decoded)) <= 0) {
			snprintf(log_line, sizeof(log_line), "[encoded] decode failed for line");
			append_log_line(runtime_dir, log_line);
			continue;
		}
		value = strchr(decoded, '=');
		if (value == NULL) {
			continue;
		}
		*value++ = '\0';
		if (strcmp(decoded, "action") == 0) {
			snprintf(state->action, sizeof(state->action), "%s", value);
		} else if (strcmp(decoded, "token") == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", value);
		} else if (strcmp(decoded, "receipt") == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", value);
		} else if (strcmp(decoded, "debug") == 0) {
			state->debug = atoi(value) != 0;
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *config_dir = NULL;
	const char *runtime_dir = "./runtime";
	EncodedState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--config") == 0 && index + 1 < argc) {
			config_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (config_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/encoded", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (load_encoded_config(config_dir, runtime_dir, &state) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[encoded] config loaded");
	snprintf(line, sizeof(line), "[encoded] action=%s", state.action);
	append_log_line(runtime_dir, line);
	if (state.debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[encoded] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[encoded] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.action, "root_write") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_write created proof artifact");
		printf("root write completed successfully\n");
		return 0;
	}
	if (strcmp(state.action, "root_write") == 0) {
		append_log_line(runtime_dir, "[encoded] root_write rejected: missing token or receipt");
	} else {
		append_log_line(runtime_dir, "[encoded] scan completed without privileged action");
	}
	printf("encoded config completed without privileged action\n");
	return 0;
}
