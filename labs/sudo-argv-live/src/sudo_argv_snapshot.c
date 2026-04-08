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

typedef struct ArgvState {
	unsigned int argc_count;
	unsigned int escape_score;
	unsigned int segment;
	uint32_t response;
	char mode[16];
	char supplied_token[32];
	char supplied_receipt[32];
	char exec_action[16];
} ArgvState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	's' ^ 0x21, 'u' ^ 0x21, 'd' ^ 0x21, 'o' ^ 0x21, '-' ^ 0x21, 't' ^ 0x21,
	'o' ^ 0x21, 'k' ^ 0x21, 'e' ^ 0x21, 'n' ^ 0x21, '-' ^ 0x21, '7' ^ 0x21, '3' ^ 0x21,
};

static char *trim_line(char *line) {
	size_t length = strlen(line);
	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[--length] = '\0';
	}
	return line;
}

static uint32_t ror32(uint32_t value, unsigned int shift) {
	shift &= 31U;
	if (shift == 0U) {
		return value;
	}
	return (value >> shift) | (value << (32U - shift));
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t index = 0;
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x21);
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
	snprintf(path, sizeof(path), "%s/sudo/sudo.log", runtime_dir);
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
	fprintf(file, "FLAG{sudo-argv-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", ((unsigned long)getpid() << 5U) ^ 0x33d1UL);
	snprintf(path, sizeof(path), "%s/sudo/sudo.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/sudo/sudo.receipt", runtime_dir);
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

static int load_auth(const char *command_dir, ArgvState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[128];

	snprintf(path, sizeof(path), "%s/auth.txt", command_dir);
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

static int parse_args(const char *command_dir, ArgvState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];

	snprintf(path, sizeof(path), "%s/args.txt", command_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		size_t line_length;
		char *value = trim_line(line);
		state->argc_count += 1U;
		line_length = strlen(value);
		if (line_length > 0 && value[line_length - 1] == '\\') {
			state->escape_score += 1U;
		}
		if (strstr(value, "\\\\") != NULL) {
			state->escape_score += 2U;
		}
		if (strstr(value, "sudoedit") != NULL) {
			state->escape_score += 1U;
		}
		if (strstr(value, "--probe") != NULL) {
			state->escape_score += 1U;
		}
		if (strstr(value, "--escalate") != NULL) {
			state->escape_score += 3U;
		}
	}
	fclose(file);
	return 0;
}

static int parse_env(const char *command_dir, ArgvState *state, const char *runtime_dir, const char *secret_token) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	uint32_t expected_response = ror32(hash_token(secret_token), 11U) ^ 0x4f13aa27U;

	snprintf(path, sizeof(path), "%s/env.txt", command_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *value = trim_line(line);
		if (strncmp(value, "MODE=", 5) == 0) {
			snprintf(state->mode, sizeof(state->mode), "%s", value + 5);
		} else if (strncmp(value, "LC_SEGMENT=", 11) == 0) {
			state->segment = (unsigned int)strtoul(value + 11, NULL, 16);
		} else if (strncmp(value, "LC_RESPONSE=", 12) == 0) {
			state->response = (uint32_t)strtoul(value + 12, NULL, 16);
		}
	}
	fclose(file);

	snprintf(line, sizeof(line), "[sudo] argc=%u escape_score=%u segment=%02x response=%08x mode=%s",
		state->argc_count, state->escape_score, state->segment, state->response, state->mode[0] != '\0' ? state->mode : "(none)");
	append_log_line(runtime_dir, line);

	if (strcmp(state->mode, "debug") == 0 && state->argc_count == 3U && state->escape_score == 3U && state->segment == 0x21U) {
		snprintf(state->exec_action, sizeof(state->exec_action), "%s", "trace_sudo");
	} else if (
		strcmp(state->mode, "commit") == 0 &&
		state->argc_count == 4U &&
		state->escape_score == 7U &&
		state->segment == 0x33U &&
		state->response == expected_response
	) {
		snprintf(state->exec_action, sizeof(state->exec_action), "%s", "root_sudo");
	}
	return 0;
}

int main(int argc, char **argv) {
	const char *command_dir = NULL;
	const char *runtime_dir = "./runtime";
	ArgvState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	memset(&state, 0, sizeof(state));
	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--command") == 0 && index + 1 < argc) {
			command_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (command_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/sudo", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	load_auth(command_dir, &state);
	if (parse_args(command_dir, &state) != 0 || parse_env(command_dir, &state, runtime_dir, secret_token) != 0) {
		append_log_line(runtime_dir, "[sudo] failed to parse command snapshot");
		return 1;
	}
	append_log_line(runtime_dir, "[sudo] command snapshot accepted");
	snprintf(line, sizeof(line), "[sudo] exec_action=%s", state.exec_action[0] != '\0' ? state.exec_action : "(none)");
	append_log_line(runtime_dir, line);
	if (strcmp(state.exec_action, "trace_sudo") == 0) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[sudo] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[sudo] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (
		load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.exec_action, "root_sudo") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0
	) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_sudo created proof artifact");
		printf("sudo proof completed successfully\n");
		return 0;
	}
	if (strcmp(state.exec_action, "root_sudo") == 0) {
		append_log_line(runtime_dir, "[sudo] root_sudo rejected: missing token or receipt");
	}
	printf("sudo snapshot completed without privileged proof\n");
	return 0;
}
