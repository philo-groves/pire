#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct BrokerState {
	char topic[96];
	char mode[16];
	char token[32];
	char receipt[32];
	int debug_token;
	int in_message;
} BrokerState;

static const unsigned char SECRET_TOKEN_XOR[] = {
	'b' ^ 0x29, 'r' ^ 0x29, 'k' ^ 0x29, '-' ^ 0x29, 't' ^ 0x29, 'o' ^ 0x29,
	'k' ^ 0x29, 'e' ^ 0x29, 'n' ^ 0x29, '-' ^ 0x29, '4' ^ 0x29, '7' ^ 0x29,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x29);
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
	snprintf(path, sizeof(path), "%s/broker/broker.log", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/broker/admin_flag.txt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "FLAG{broker-live}\n");
	fclose(file);
	return 0;
}

static int load_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(path, sizeof(path), "%s/broker/broker.receipt", runtime_dir);
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

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x4747UL);
	snprintf(path, sizeof(path), "%s/broker/broker.receipt", runtime_dir);
	file = fopen(path, "w");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	fprintf(file, "%s\n", receipt);
	fclose(file);
	return 0;
}

static int load_session(const char *session_dir, BrokerState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];
	memset(state, 0, sizeof(*state));
	snprintf(state->mode, sizeof(state->mode), "%s", "normal");
	snprintf(path, sizeof(path), "%s/session.txt", session_dir);
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
		if (strcmp(line, "DEBUG TOKEN") == 0) {
			state->debug_token = 1;
			continue;
		}
		if (strncmp(line, "SUBSCRIBE ", 10) == 0) {
			snprintf(state->topic, sizeof(state->topic), "%s", line + 10);
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
		} else if (strcmp(line, "Broker-Token") == 0) {
			snprintf(state->token, sizeof(state->token), "%s", value);
		} else if (strcmp(line, "Broker-Receipt") == 0) {
			snprintf(state->receipt, sizeof(state->receipt), "%s", value);
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *session_dir = NULL;
	const char *runtime_dir = "./runtime";
	BrokerState state;
	char secret_token[32];
	char receipt[32];
	char line[256];
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
	snprintf(line, sizeof(line), "%s/broker", runtime_dir);
	ensure_dir(line);
	if (load_session(session_dir, &state) != 0) {
		return 1;
	}
	append_log_line(runtime_dir, "[broker] loaded session");
	snprintf(line, sizeof(line), "[broker] topic=%s", state.topic[0] != '\0' ? state.topic : "(none)");
	append_log_line(runtime_dir, line);
	snprintf(line, sizeof(line), "[broker] mode=%s", state.mode);
	append_log_line(runtime_dir, line);
	if (state.debug_token) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[broker] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[broker] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strstr(state.topic, "${admin_exec}") != NULL && strcmp(state.mode, "elevate") == 0 &&
		strcmp(state.token, secret_token) == 0 && strcmp(state.receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[broker] admin_exec dispatched proof path");
		printf("admin dispatch executed successfully\n");
		return 0;
	}
	if (strstr(state.topic, "${admin_exec}") != NULL) {
		append_log_line(runtime_dir, "[broker] admin_exec rejected: missing token, receipt, or elevate mode");
	} else {
		append_log_line(runtime_dir, "[broker] message accepted without admin dispatch");
	}
	printf("broker session completed without admin proof\n");
	return 0;
}
