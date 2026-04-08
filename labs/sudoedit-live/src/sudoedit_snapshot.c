#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct InvocationState {
	char escaped_target[64];
	char policy_mode[16];
	char supplied_token[32];
	char note[64];
	int debug_token;
	int sudoedit_mode;
} InvocationState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'r' ^ 0x19,
	'o' ^ 0x19,
	'o' ^ 0x19,
	't' ^ 0x19,
	'-' ^ 0x19,
	't' ^ 0x19,
	'o' ^ 0x19,
	'k' ^ 0x19,
	'e' ^ 0x19,
	'n' ^ 0x19,
	'-' ^ 0x19,
	'4' ^ 0x19,
	'2' ^ 0x19,
};

static void usage(const char *argv0) {
	fprintf(stderr, "usage: %s --invocation <dir> [--runtime <dir>]\n", argv0);
}

static void decode_secret_token(char *output, size_t output_size) {
	size_t token_length = sizeof(SECRET_TOKEN_XOR) / sizeof(SECRET_TOKEN_XOR[0]);
	size_t index = 0;

	if (output_size == 0) {
		return;
	}

	for (; index < token_length && index + 1 < output_size; index++) {
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x19);
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

	if (snprintf(path, sizeof(path), "%s/user/sudoedit.log", runtime_dir) >= (int)sizeof(path)) {
		fprintf(stderr, "runtime path too long\n");
		return -1;
	}

	log_file = fopen(path, "a");
	if (log_file == NULL) {
		perror(path);
		return -1;
	}

	fprintf(log_file, "%s\n", line);
	fclose(log_file);
	return 0;
}

static int write_root_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *flag_file = NULL;

	if (snprintf(path, sizeof(path), "%s/root/root_flag.txt", runtime_dir) >= (int)sizeof(path)) {
		fprintf(stderr, "runtime path too long\n");
		return -1;
	}

	flag_file = fopen(path, "w");
	if (flag_file == NULL) {
		perror(path);
		return -1;
	}

	fprintf(flag_file, "FLAG{sudoedit-live}\n");
	fclose(flag_file);
	return 0;
}

static char *trim_line(char *line) {
	size_t length = strlen(line);

	while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
		line[length - 1] = '\0';
		length--;
	}

	return line;
}

static void escape_target_unsafe(char *dst, const char *src) {
	size_t index = 0;
	size_t write_index = 0;

	while (src[index] != '\0') {
		if (src[index] == '\\') {
			dst[write_index++] = '\\';
			dst[write_index++] = '\\';
		} else {
			dst[write_index++] = src[index];
		}
		index++;
	}
	dst[write_index] = '\0';
}

static int load_environment(const char *invocation_dir, InvocationState *state) {
	char path[PATH_MAX];
	FILE *env_file = NULL;
	char line[256];

	if (snprintf(path, sizeof(path), "%s/env.list", invocation_dir) >= (int)sizeof(path)) {
		fprintf(stderr, "invocation path too long\n");
		return -1;
	}

	env_file = fopen(path, "r");
	if (env_file == NULL) {
		perror(path);
		return -1;
	}

	while (fgets(line, sizeof(line), env_file) != NULL) {
		char *value = NULL;
		trim_line(line);
		if (line[0] == '\0' || line[0] == '#') {
			continue;
		}

		value = strchr(line, '=');
		if (value == NULL) {
			continue;
		}

		*value = '\0';
		value++;

		if (strcmp(line, "SUDO_EDITOR") == 0) {
			snprintf(state->note, sizeof(state->note), "%s", value);
		} else if (strcmp(line, "SUDO_TOKEN") == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", value);
		}
	}

	fclose(env_file);
	return 0;
}

static int load_invocation(const char *invocation_dir, InvocationState *state) {
	char path[PATH_MAX];
	FILE *argv_file = NULL;
	char line[256];

	memset(state, 0, sizeof(*state));
	snprintf(state->policy_mode, sizeof(state->policy_mode), "%s", "sudoers");

	if (load_environment(invocation_dir, state) != 0) {
		return -1;
	}

	if (snprintf(path, sizeof(path), "%s/argv.txt", invocation_dir) >= (int)sizeof(path)) {
		fprintf(stderr, "invocation path too long\n");
		return -1;
	}

	argv_file = fopen(path, "r");
	if (argv_file == NULL) {
		perror(path);
		return -1;
	}

	while (fgets(line, sizeof(line), argv_file) != NULL) {
		trim_line(line);
		if (line[0] == '\0' || line[0] == '#') {
			continue;
		}

		if (strcmp(line, "--sudoedit") == 0) {
			state->sudoedit_mode = 1;
		} else if (strcmp(line, "--debug-token") == 0) {
			state->debug_token = 1;
		} else if (line[0] != '-') {
			/* Intentional overflow for lab use. */
			escape_target_unsafe(state->escaped_target, line);
		}
	}

	fclose(argv_file);
	return 0;
}

int main(int argc, char **argv) {
	const char *invocation_dir = NULL;
	const char *runtime_dir = "./runtime";
	InvocationState state;
	char secret_token[32];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--invocation") == 0 && index + 1 < argc) {
			invocation_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		} else {
			usage(argv[0]);
			return 2;
		}
	}

	if (invocation_dir == NULL) {
		usage(argv[0]);
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));

	if (ensure_dir(runtime_dir) != 0) {
		return 1;
	}

	snprintf(line, sizeof(line), "%s/user", runtime_dir);
	if (ensure_dir(line) != 0) {
		return 1;
	}

	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	if (ensure_dir(line) != 0) {
		return 1;
	}

	if (load_invocation(invocation_dir, &state) != 0) {
		return 1;
	}

	append_log_line(runtime_dir, "[sudoedit] loaded invocation");
	snprintf(line, sizeof(line), "[sudoedit] escaped_target=%s", state.escaped_target);
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[sudoedit] policy_mode=%s", state.policy_mode);
	append_log_line(runtime_dir, line);

	if (state.debug_token) {
		snprintf(line, sizeof(line), "[user] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		fprintf(stderr, "debug token disclosure emitted to user log\n");
	}

	if (state.sudoedit_mode && strcmp(state.policy_mode, "root_write") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0) {
		if (write_root_flag(runtime_dir) != 0) {
			return 1;
		}
		append_log_line(runtime_dir, "[root] root_write policy created proof artifact");
		printf("root write completed successfully\n");
		return 0;
	}

	if (state.sudoedit_mode) {
		snprintf(line, sizeof(line), "[user] sudoedit note=%s", state.note[0] != '\0' ? state.note : "no editor");
		append_log_line(runtime_dir, line);
	}

	printf("sudoedit invocation completed without privileged action\n");
	return 0;
}
