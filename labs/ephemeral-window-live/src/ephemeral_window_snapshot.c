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

typedef struct WindowState {
	char mode[16];
	char supplied_token[32];
	char supplied_receipt[32];
	char supplied_response[32];
} WindowState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'w' ^ 0x29, 'i' ^ 0x29, 'n' ^ 0x29, 'd' ^ 0x29, 'o' ^ 0x29, 'w' ^ 0x29,
	'-' ^ 0x29, 't' ^ 0x29, 'o' ^ 0x29, 'k' ^ 0x29, 'e' ^ 0x29, 'n' ^ 0x29,
	'-' ^ 0x29, '5' ^ 0x29, '7' ^ 0x29,
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
	snprintf(path, sizeof(path), "%s/window/window.log", runtime_dir);
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
	fprintf(file, "FLAG{ephemeral-window-live}\n");
	fclose(file);
	return 0;
}

static int save_text_file(const char *path, const char *text) {
	FILE *file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", text);
	fclose(file);
	return 0;
}

static int save_window_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	snprintf(receipt, receipt_size, "%08lx", ((unsigned long)getpid() << 2U) ^ 0x5757UL);
	snprintf(path, sizeof(path), "%s/window/window.receipt", runtime_dir);
	return save_text_file(path, receipt);
}

static int load_window_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/window/window.receipt", runtime_dir);
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

static int save_window_challenge(const char *runtime_dir, uint32_t challenge) {
	char path[PATH_MAX];
	char text[32];
	snprintf(text, sizeof(text), "%08x", challenge);
	snprintf(path, sizeof(path), "%s/window/challenge.hex", runtime_dir);
	return save_text_file(path, text);
}

static int load_window_challenge(const char *runtime_dir, uint32_t *challenge) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[32];
	snprintf(path, sizeof(path), "%s/window/challenge.hex", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(line, sizeof(line), file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(line);
	*challenge = (uint32_t)strtoul(line, NULL, 16);
	return 0;
}

static int save_window_status(const char *runtime_dir, const char *status) {
	char path[PATH_MAX];
	snprintf(path, sizeof(path), "%s/window/state.txt", runtime_dir);
	return save_text_file(path, status);
}

static int load_window_status(const char *runtime_dir, char *status, size_t status_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/window/state.txt", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(status, (int)status_size, file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(status);
	return 0;
}

static int save_window_armed(const char *runtime_dir, const char *armed_value) {
	char path[PATH_MAX];
	snprintf(path, sizeof(path), "%s/window/armed.hex", runtime_dir);
	return save_text_file(path, armed_value);
}

static int load_window_armed(const char *runtime_dir, char *armed_value, size_t armed_value_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/window/armed.hex", runtime_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		return -1;
	}
	if (fgets(armed_value, (int)armed_value_size, file) == NULL) {
		fclose(file);
		return -1;
	}
	fclose(file);
	trim_line(armed_value);
	return 0;
}

static int load_session(const char *session_dir, WindowState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(state, 0, sizeof(*state));
	snprintf(path, sizeof(path), "%s/session.ini", session_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *value = NULL;
		trim_line(line);
		value = strchr(line, '=');
		if (value == NULL) {
			continue;
		}
		*value++ = '\0';
		if (strcmp(line, "mode") == 0) {
			snprintf(state->mode, sizeof(state->mode), "%s", value);
		} else if (strcmp(line, "token") == 0) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", value);
		} else if (strcmp(line, "response") == 0) {
			snprintf(state->supplied_response, sizeof(state->supplied_response), "%s", value);
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *session_dir = NULL;
	const char *runtime_dir = "./runtime";
	WindowState state;
	char secret_token[32];
	char receipt[32];
	char armed_value[32];
	char status[32];
	char line[256];
	uint32_t challenge = 0;
	uint32_t expected = 0;
	uint32_t armed_expected = 0;
	uint32_t supplied = 0;
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--session") == 0 && index + 1 < argc) {
			session_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (session_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/window", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (load_session(session_dir, &state) != 0) {
		return 1;
	}

	if (strcmp(state.mode, "debug") == 0) {
		challenge = ((uint32_t)getpid() << 4U) ^ 0x00e17057U;
		save_window_challenge(runtime_dir, challenge);
		save_window_receipt(runtime_dir, receipt, sizeof(receipt));
		save_window_status(runtime_dir, "disclosed");
		append_log_line(runtime_dir, "[window] phase=debug");
		snprintf(line, sizeof(line), "[window] challenge=%08x", challenge);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[window] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[window] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
		printf("window disclosure complete\n");
		return 0;
	}

	if (strcmp(state.mode, "prime") == 0) {
		if (load_window_status(runtime_dir, status, sizeof(status)) != 0 || strcmp(status, "disclosed") != 0) {
			append_log_line(runtime_dir, "[window] prime rejected: window is not disclosed");
			printf("window prime failed\n");
			return 1;
		}
		if (load_window_challenge(runtime_dir, &challenge) != 0 || load_window_receipt(runtime_dir, receipt, sizeof(receipt)) != 0) {
			append_log_line(runtime_dir, "[window] prime rejected: missing challenge or receipt");
			printf("window prime failed\n");
			return 1;
		}
		expected = rol32(hash_token(secret_token) ^ challenge, 9U) ^ 0x71b42d3cU;
		supplied = (uint32_t)strtoul(state.supplied_response, NULL, 16);
		snprintf(line, sizeof(line), "[window] prime expected=%08x supplied=%08x", expected, supplied);
		append_log_line(runtime_dir, line);
		if (supplied == expected) {
			armed_expected = rol32(expected ^ challenge ^ 0x13572468U, 3U) ^ 0x51c3d2e1U;
			snprintf(armed_value, sizeof(armed_value), "%08x", armed_expected);
			save_window_armed(runtime_dir, armed_value);
			save_window_status(runtime_dir, "primed");
			append_log_line(runtime_dir, "[window] prime accepted");
			printf("window prime complete\n");
			return 0;
		}
		save_window_status(runtime_dir, "burned");
		append_log_line(runtime_dir, "[window] prime rejected: window burned by invalid response");
		printf("window prime failed\n");
		return 0;
	}

	if (strcmp(state.mode, "commit") == 0) {
		if (load_window_status(runtime_dir, status, sizeof(status)) != 0 || strcmp(status, "primed") != 0) {
			append_log_line(runtime_dir, "[window] commit rejected: window is not primed");
			printf("window commit failed\n");
			return 1;
		}
		if (
			load_window_challenge(runtime_dir, &challenge) != 0 ||
			load_window_receipt(runtime_dir, receipt, sizeof(receipt)) != 0 ||
			load_window_armed(runtime_dir, armed_value, sizeof(armed_value)) != 0
		) {
			append_log_line(runtime_dir, "[window] commit rejected: missing challenge, receipt, or armed state");
			printf("window commit failed\n");
			return 1;
		}
		expected = (uint32_t)strtoul(armed_value, NULL, 16);
		supplied = (uint32_t)strtoul(state.supplied_response, NULL, 16);
		snprintf(line, sizeof(line), "[window] challenge=%08x expected=%08x supplied=%08x", challenge, expected, supplied);
		append_log_line(runtime_dir, line);
		if (
			strcmp(state.supplied_token, secret_token) == 0 &&
			strcmp(state.supplied_receipt, receipt) == 0 &&
			supplied == expected
		) {
			save_window_status(runtime_dir, "consumed");
			write_flag(runtime_dir);
			append_log_line(runtime_dir, "[root] root_window created proof artifact");
			printf("window proof completed successfully\n");
			return 0;
		}
		save_window_status(runtime_dir, "burned");
		append_log_line(runtime_dir, "[window] commit rejected: window burned by invalid proof");
		printf("window commit failed\n");
		return 0;
	}

	append_log_line(runtime_dir, "[window] session completed without privileged action");
	printf("session completed without privileged action\n");
	return 0;
}
