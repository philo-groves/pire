#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct RendererState {
	char channel[96];
	char mode[16];
	char token[32];
	char receipt[32];
	int debug_leak;
	int in_message;
} RendererState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'h' ^ 0x27, 'o' ^ 0x27, 's' ^ 0x27, 't' ^ 0x27, '-' ^ 0x27, 't' ^ 0x27,
	'o' ^ 0x27, 'k' ^ 0x27, 'e' ^ 0x27, 'n' ^ 0x27, '-' ^ 0x27, '6' ^ 0x27, '1' ^ 0x27,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x27);
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
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/sandbox/renderer.log", runtime_dir);
	file = fopen(path, "a");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", line);
	fclose(file);
	return 0;
}

static int write_flag(const char *runtime_dir) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/host/host_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{renderer-escape-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x6161UL);
	snprintf(path, sizeof(path), "%s/sandbox/escape.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/sandbox/escape.receipt", runtime_dir);
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

static int load_page(const char *page_dir, RendererState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(state, 0, sizeof(*state));
	snprintf(state->mode, sizeof(state->mode), "%s", "render");
	snprintf(path, sizeof(path), "%s/page.txt", page_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		char *value = NULL;
		trim_line(line);
		if (strcmp(line, "MESSAGE") == 0) {
			state->in_message = 1;
			continue;
		}
		if (strcmp(line, "END") == 0) {
			state->in_message = 0;
			continue;
		}
		if (strcmp(line, "DEBUG LEAK") == 0) {
			state->debug_leak = 1;
			continue;
		}
		if (strncmp(line, "CHANNEL ", 8) == 0) {
			snprintf(state->channel, sizeof(state->channel), "%s", line + 8);
			continue;
		}
		if (!state->in_message) {
			continue;
		}
		value = strchr(line, ':');
		if (value == NULL) {
			continue;
		}
		*value++ = '\0';
		while (*value == ' ') {
			value++;
		}
		if (strcmp(line, "Mode") == 0) {
			snprintf(state->mode, sizeof(state->mode), "%s", value);
		} else if (strcmp(line, "Escape-Token") == 0) {
			snprintf(state->token, sizeof(state->token), "%s", value);
		} else if (strcmp(line, "Escape-Receipt") == 0) {
			snprintf(state->receipt, sizeof(state->receipt), "%s", value);
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *page_dir = NULL;
	const char *runtime_dir = "./runtime";
	RendererState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--page") == 0 && index + 1 < argc) {
			page_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (page_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/sandbox", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/host", runtime_dir);
	ensure_dir(line);
	if (load_page(page_dir, &state) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[renderer] loaded page");
	snprintf(line, sizeof(line), "[renderer] channel=%s", state.channel[0] != '\0' ? state.channel : "(none)");
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[renderer] mode=%s", state.mode);
	append_log_line(runtime_dir, line);
	if (state.debug_leak) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[sandbox] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[sandbox] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strstr(state.channel, "${broker_escape}") != NULL && strcmp(state.mode, "host_write") == 0 &&
		strcmp(state.token, secret_token) == 0 && strcmp(state.receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[host] broker_escape crossed sandbox boundary");
		printf("host boundary crossed successfully\n");
		return 0;
	}
	if (strstr(state.channel, "${broker_escape}") != NULL) {
		append_log_line(runtime_dir, "[sandbox] broker_escape rejected: missing token, receipt, or host mode");
	} else {
		append_log_line(runtime_dir, "[sandbox] page rendered without broker escape");
	}
	printf("renderer completed without host proof\n");
	return 0;
}
