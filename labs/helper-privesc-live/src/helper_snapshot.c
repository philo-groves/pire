#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct HelperState {
	char resource[32];
	char action[16];
	char token[16];
	char receipt[32];
	char note[64];
} HelperState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'r' ^ 0x23, 'o' ^ 0x23, 'o' ^ 0x23, 't' ^ 0x23, '-' ^ 0x23, 't' ^ 0x23,
	'o' ^ 0x23, 'k' ^ 0x23, 'e' ^ 0x23, 'n' ^ 0x23, '-' ^ 0x23, '7' ^ 0x23, '2' ^ 0x23,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x23);
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
	snprintf(path, sizeof(path), "%s/user/helper.log", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/root/root_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{helper-privesc-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x7272UL);
	snprintf(path, sizeof(path), "%s/user/helper.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/user/helper.receipt", runtime_dir);
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

static void unsafe_copy(char *dst, const char *src) {
	size_t index = 0;
	while (src[index] != '\0') {
		dst[index] = src[index];
		index++;
	}
	dst[index] = '\0';
}

static int load_request(const char *request_dir, HelperState *state, int *debug) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(state, 0, sizeof(*state));
	snprintf(state->action, sizeof(state->action), "%s", "user_open");
	snprintf(path, sizeof(path), "%s/request.ini", request_dir);
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
		if (strcmp(line, "resource") == 0) {
			unsafe_copy(state->resource, value);
		} else if (strcmp(line, "token") == 0) {
			snprintf(state->token, sizeof(state->token), "%s", value);
		} else if (strcmp(line, "receipt") == 0) {
			snprintf(state->receipt, sizeof(state->receipt), "%s", value);
		} else if (strcmp(line, "debug") == 0) {
			*debug = atoi(value) != 0;
		} else if (strcmp(line, "note") == 0) {
			snprintf(state->note, sizeof(state->note), "%s", value);
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *request_dir = NULL;
	const char *runtime_dir = "./runtime";
	HelperState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
	int debug = 0;
	int index = 0;

	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--request") == 0 && index + 1 < argc) {
			request_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (request_dir == NULL) {
		return 2;
	}

	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/user", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (load_request(request_dir, &state, &debug) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[helper] loaded request");
	snprintf(line, sizeof(line), "[helper] resource=%s", state.resource);
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[helper] action=%s", state.action);
	append_log_line(runtime_dir, line);
	if (debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[helper] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[helper] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.action, "root_exec") == 0 && strcmp(state.token, secret_token) == 0 &&
		strcmp(state.receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_exec helper created proof artifact");
		printf("root helper executed successfully\n");
		return 0;
	}
	if (strcmp(state.action, "root_exec") == 0) {
		append_log_line(runtime_dir, "[helper] root_exec rejected: missing token or proof receipt");
	} else {
		append_log_line(runtime_dir, "[helper] request handled without privileged action");
	}
	printf("helper request completed without privileged action\n");
	return 0;
}
