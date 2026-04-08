#define _POSIX_C_SOURCE 200809L

#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

/*
 * Narrow harness around the vulnerable sudo v1.9.5p1 logic behind
 * CVE-2021-3156. The flag constants and the MODE_EDIT|MODE_SHELL path
 * are derived from upstream src/sudo.h, src/parse_args.c, and
 * plugins/sudoers/sudoers.c at tag v1.9.5p1.
 */

#define MODE_RUN 0x00000001
#define MODE_EDIT 0x00000002
#define MODE_SHELL 0x00020000
#define MODE_LOGIN_SHELL 0x00040000

#define MAX_ARGS 16
#define MAX_LINE 256

typedef struct SameditState {
	int mode;
	int flags;
	unsigned int argc_count;
	unsigned int injected_nuls;
	unsigned int overflow_writes;
	unsigned int escaped_pairs;
	uint32_t response;
	char user_args[512];
	char supplied_token[32];
	char supplied_receipt[32];
	char exec_action[16];
} SameditState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	's' ^ 0x56, 'a' ^ 0x56, 'm' ^ 0x56, 'e' ^ 0x56, 'd' ^ 0x56, 'i' ^ 0x56,
	't' ^ 0x56, '-' ^ 0x56, 't' ^ 0x56, 'o' ^ 0x56, 'k' ^ 0x56, 'e' ^ 0x56,
	'n' ^ 0x56, '-' ^ 0x56, '3' ^ 0x56, '1' ^ 0x56, '5' ^ 0x56, '6' ^ 0x56,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x56);
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
	snprintf(path, sizeof(path), "%s/samedit/samedit.log", runtime_dir);
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
	fprintf(file, "FLAG{sudo-baron-samedit-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", ((unsigned long)getpid() << 6U) ^ 0x3156UL);
	snprintf(path, sizeof(path), "%s/samedit/samedit.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/samedit/samedit.receipt", runtime_dir);
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

static int load_auth(const char *command_dir, SameditState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[MAX_LINE];

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

static int load_response(const char *command_dir, SameditState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[MAX_LINE];

	snprintf(path, sizeof(path), "%s/response.txt", command_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return 0;
	}
	if (fgets(line, sizeof(line), file) != NULL) {
		state->response = (uint32_t)strtoul(trim_line(line), NULL, 16);
	}
	fclose(file);
	return 0;
}

static int load_args(const char *command_dir, char args[][MAX_LINE], size_t *argc_out) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[MAX_LINE];
	size_t count = 0;

	snprintf(path, sizeof(path), "%s/args.txt", command_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (count < MAX_ARGS && fgets(line, sizeof(line), file) != NULL) {
		snprintf(args[count], MAX_LINE, "%s", trim_line(line));
		count += 1U;
	}
	fclose(file);
	*argc_out = count;
	return count > 0U ? 0 : -1;
}

static void parse_mode_from_args(char args[][MAX_LINE], size_t argc, SameditState *state) {
	size_t index = 0;
	const char *progname = args[0];
	size_t proglen = strlen(progname);

	if (proglen > 4U && strcmp(progname + proglen - 4U, "edit") == 0) {
		state->mode = MODE_EDIT;
	}
	for (index = 1; index < argc; index++) {
		if (strcmp(args[index], "-e") == 0) {
			state->mode = MODE_EDIT;
		} else if (strcmp(args[index], "-s") == 0) {
			state->flags |= MODE_SHELL;
		} else if (strcmp(args[index], "-i") == 0) {
			state->flags |= MODE_LOGIN_SHELL;
			state->flags |= MODE_SHELL;
		}
	}
	if (state->mode == 0) {
		state->mode = MODE_RUN;
	}
}

static void build_user_args_vulnerable(char args[][MAX_LINE], size_t argc, SameditState *state) {
	/*
	 * This mirrors the vulnerable v1.9.5p1 set_cmnd() unescape path:
	 * it allocates from the original argv lengths, then unescapes while
	 * copying when MODE_SHELL is set.
	 */
	char allocated[512];
	char *to = allocated;
	size_t size = 0;
	size_t index;

	memset(allocated, 0, sizeof(allocated));
	for (index = 1; index < argc; index++) {
		size += strlen(args[index]) + 1U;
	}
	for (index = 1; index < argc; index++) {
		char *from = args[index];
		while (*from != '\0') {
			if (from[0] == '\\' && !isspace((unsigned char)from[1])) {
				if (from[1] == '\0') {
					state->injected_nuls += 1U;
				} else {
					state->escaped_pairs += 1U;
				}
				from++;
			}
			if ((size_t)(to - allocated) >= size) {
				state->overflow_writes += 1U;
			}
			*to++ = *from++;
		}
		if ((size_t)(to - allocated) >= size) {
			state->overflow_writes += 1U;
		}
		*to++ = ' ';
	}
	if (to != allocated) {
		to--;
	}
	*to = '\0';
	snprintf(state->user_args, sizeof(state->user_args), "%s", allocated);
}

static int evaluate_command(const char *runtime_dir, SameditState *state, const char *secret_token) {
	uint32_t expected_response =
		rol32(hash_token(secret_token), 3U) ^
		((uint32_t)strlen(state->user_args) << 8U) ^
		(state->injected_nuls << 4U) ^
		(state->overflow_writes) ^
		0x3156f00dU;
	char line[256];
	int sudo_mode = state->mode | state->flags;

	snprintf(line, sizeof(line),
		"[samedit] mode=%08x argc=%u injected_nuls=%u overflow_writes=%u escaped_pairs=%u response=%08x",
		sudo_mode, state->argc_count, state->injected_nuls, state->overflow_writes, state->escaped_pairs, state->response);
	append_log_line(runtime_dir, line);

	if (
		(sudo_mode & MODE_EDIT) != 0 &&
		(sudo_mode & MODE_SHELL) != 0 &&
		state->argc_count == 3U &&
		state->injected_nuls == 1U
	) {
		snprintf(state->exec_action, sizeof(state->exec_action), "%s", "trace_samedit");
	} else if (
		(sudo_mode & MODE_EDIT) != 0 &&
		(sudo_mode & MODE_SHELL) != 0 &&
		state->argc_count == 4U &&
		state->injected_nuls == 1U &&
		state->overflow_writes > 0U &&
		state->response == expected_response
	) {
		snprintf(state->exec_action, sizeof(state->exec_action), "%s", "root_samedit");
	}

	return 0;
}

int main(int argc, char **argv) {
	const char *command_dir = NULL;
	const char *runtime_dir = "./runtime";
	SameditState state;
	char args[MAX_ARGS][MAX_LINE];
	size_t loaded_argc = 0;
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
	snprintf(line, sizeof(line), "%s/samedit", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);

	load_auth(command_dir, &state);
	load_response(command_dir, &state);
	if (load_args(command_dir, args, &loaded_argc) != 0) {
		append_log_line(runtime_dir, "[samedit] failed to load args");
		return 1;
	}
	state.argc_count = (unsigned int)loaded_argc;
	parse_mode_from_args(args, loaded_argc, &state);
	build_user_args_vulnerable(args, loaded_argc, &state);
	evaluate_command(runtime_dir, &state, secret_token);
	append_log_line(runtime_dir, "[samedit] command snapshot accepted");
	snprintf(line, sizeof(line), "[samedit] exec_action=%s", state.exec_action[0] != '\0' ? state.exec_action : "(none)");
	append_log_line(runtime_dir, line);

	if (strcmp(state.exec_action, "trace_samedit") == 0) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[samedit] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[samedit] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}

	if (
		load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.exec_action, "root_samedit") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0
	) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_samedit created proof artifact");
		printf("samedit proof completed successfully\n");
		return 0;
	}
	if (strcmp(state.exec_action, "root_samedit") == 0) {
		append_log_line(runtime_dir, "[samedit] root_samedit rejected: missing token or receipt");
	}
	printf("samedit snapshot completed without privileged proof\n");
	return 0;
}
