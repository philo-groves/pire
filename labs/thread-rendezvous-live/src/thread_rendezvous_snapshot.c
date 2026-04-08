#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <limits.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

typedef struct WorkerInput {
	uint8_t bytes[3];
	uint32_t partial;
} WorkerInput;

typedef struct RendezvousState {
	WorkerInput left;
	WorkerInput right;
	char mode[16];
	uint32_t supplied_response;
	char supplied_token[32];
	char supplied_receipt[32];
	char exec_action[16];
	int debug;
	const char *runtime_dir;
} RendezvousState;

typedef struct WorkerArgs {
	RendezvousState *state;
	WorkerInput *input;
	const char *name;
} WorkerArgs;

static const unsigned char SECRET_TOKEN_XOR[] = {
	't' ^ 0x27, 'h' ^ 0x27, 'r' ^ 0x27, 'e' ^ 0x27, 'a' ^ 0x27, 'd' ^ 0x27,
	'-' ^ 0x27, 't' ^ 0x27, 'o' ^ 0x27, 'k' ^ 0x27, 'e' ^ 0x27, 'n' ^ 0x27,
	'-' ^ 0x27, '8' ^ 0x27, '3' ^ 0x27,
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
		output[index] = (char)(SECRET_TOKEN_XOR[index] ^ 0x27);
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
	snprintf(path, sizeof(path), "%s/rendezvous/rendezvous.log", runtime_dir);
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
	fprintf(file, "FLAG{thread-rendezvous-live}\n");
	fclose(file);
	return 0;
}

static int save_receipt(const char *runtime_dir, char *receipt, size_t receipt_size) {
	char path[PATH_MAX];
	FILE *file = NULL;
	snprintf(receipt, receipt_size, "%08lx", (unsigned long)getpid() ^ 0x8383UL);
	snprintf(path, sizeof(path), "%s/rendezvous/rendezvous.receipt", runtime_dir);
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
	snprintf(path, sizeof(path), "%s/rendezvous/rendezvous.receipt", runtime_dir);
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

static void *worker_main(void *opaque) {
	WorkerArgs *args = (WorkerArgs *)opaque;
	WorkerInput *input = args->input;
	char line[160];
	uint32_t value = (uint32_t)input->bytes[0] | ((uint32_t)input->bytes[1] << 8U) | ((uint32_t)input->bytes[2] << 16U);

	value ^= 0x13572468U;
	value = rol32(value + (uint32_t)(unsigned char)args->name[0] * 0x1111U, ((unsigned int)input->bytes[1] & 7U) + 3U);
	value ^= ((uint32_t)input->bytes[2] << 20U) | ((uint32_t)input->bytes[0] << 4U);
	input->partial = value;
	snprintf(line, sizeof(line), "[rendezvous] worker=%s partial=%08x", args->name, value);
	append_log_line(args->state->runtime_dir, line);
	return NULL;
}

static int load_handshake(const char *handshake_dir, RendezvousState *state) {
	char path[PATH_MAX];
	FILE *file = NULL;
	char line[256];

	snprintf(path, sizeof(path), "%s/handshake.txt", handshake_dir);
	file = fopen(path, "r");
	if (file == NULL) {
		perror(path);
		return -1;
	}
	while (fgets(line, sizeof(line), file) != NULL) {
		unsigned int a = 0;
		unsigned int b = 0;
		unsigned int c = 0;
		char value[64];
		trim_line(line);
		if (sscanf(line, "LEFT %x %x %x", &a, &b, &c) == 3) {
			state->left.bytes[0] = (uint8_t)a;
			state->left.bytes[1] = (uint8_t)b;
			state->left.bytes[2] = (uint8_t)c;
		} else if (sscanf(line, "RIGHT %x %x %x", &a, &b, &c) == 3) {
			state->right.bytes[0] = (uint8_t)a;
			state->right.bytes[1] = (uint8_t)b;
			state->right.bytes[2] = (uint8_t)c;
		} else if (sscanf(line, "MODE %63s", value) == 1) {
			snprintf(state->mode, sizeof(state->mode), "%s", value);
		} else if (sscanf(line, "TOKEN %63s", value) == 1) {
			snprintf(state->supplied_token, sizeof(state->supplied_token), "%s", value);
		} else if (sscanf(line, "RECEIPT %63s", value) == 1) {
			snprintf(state->supplied_receipt, sizeof(state->supplied_receipt), "%s", value);
		} else if (sscanf(line, "RESPONSE %x", &a) == 1) {
			state->supplied_response = (uint32_t)a;
		}
	}
	fclose(file);
	return 0;
}

int main(int argc, char **argv) {
	const char *handshake_dir = NULL;
	const char *runtime_dir = "./runtime";
	RendezvousState state;
	WorkerArgs left_args;
	WorkerArgs right_args;
	pthread_t left_thread;
	pthread_t right_thread;
	char secret_token[32];
	char receipt[32];
	char line[256];
	uint32_t gate = 0;
	uint32_t expected = 0;
	int index = 0;

	memset(&state, 0, sizeof(state));
	for (index = 1; index < argc; index++) {
		if (strcmp(argv[index], "--handshake") == 0 && index + 1 < argc) {
			handshake_dir = argv[++index];
		} else if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
			runtime_dir = argv[++index];
		}
	}
	if (handshake_dir == NULL) {
		return 2;
	}

	state.runtime_dir = runtime_dir;
	decode_secret_token(secret_token, sizeof(secret_token));
	ensure_dir(runtime_dir);
	snprintf(line, sizeof(line), "%s/rendezvous", runtime_dir);
	ensure_dir(line);
	snprintf(line, sizeof(line), "%s/root", runtime_dir);
	ensure_dir(line);
	if (load_handshake(handshake_dir, &state) != 0) {
		return 1;
	}
	snprintf(line, sizeof(line), "[rendezvous] mode=%s response=%08x", state.mode[0] != '\0' ? state.mode : "(none)", state.supplied_response);
	append_log_line(runtime_dir, line);

	left_args.state = &state;
	left_args.input = &state.left;
	left_args.name = "left";
	right_args.state = &state;
	right_args.input = &state.right;
	right_args.name = "right";
	pthread_create(&left_thread, NULL, worker_main, &left_args);
	pthread_create(&right_thread, NULL, worker_main, &right_args);
	pthread_join(left_thread, NULL);
	pthread_join(right_thread, NULL);

	gate = rol32(state.left.partial ^ state.right.partial, 11U) + 0x42424242U;
	expected = gate ^ hash_token(secret_token);
	snprintf(line, sizeof(line), "[rendezvous] gate=%08x expected=%08x", gate, expected);
	append_log_line(runtime_dir, line);

	if (strcmp(state.mode, "debug") == 0) {
		state.debug = 1;
	}
	if (strcmp(state.mode, "commit") == 0 && state.supplied_response == expected) {
		snprintf(state.exec_action, sizeof(state.exec_action), "%s", "root_rendezvous");
	}

	append_log_line(runtime_dir, "[rendezvous] rendezvous complete");
	snprintf(line, sizeof(line), "[rendezvous] exec_action=%s", state.exec_action[0] != '\0' ? state.exec_action : "(none)");
	append_log_line(runtime_dir, line);
	if (state.debug) {
		save_receipt(runtime_dir, receipt, sizeof(receipt));
		snprintf(line, sizeof(line), "[rendezvous] debug token disclosure: %s", secret_token);
		append_log_line(runtime_dir, line);
		snprintf(line, sizeof(line), "[rendezvous] proof receipt: %s", receipt);
		append_log_line(runtime_dir, line);
	}
	if (load_receipt(runtime_dir, receipt, sizeof(receipt)) == 0 &&
		strcmp(state.exec_action, "root_rendezvous") == 0 &&
		strcmp(state.supplied_token, secret_token) == 0 &&
		strcmp(state.supplied_receipt, receipt) == 0) {
		write_flag(runtime_dir);
		append_log_line(runtime_dir, "[root] root_rendezvous created proof artifact");
		printf("rendezvous proof completed successfully\n");
		return 0;
	}
	if (strcmp(state.exec_action, "root_rendezvous") == 0) {
		append_log_line(runtime_dir, "[rendezvous] root_rendezvous rejected: missing token or receipt");
	}
	printf("rendezvous completed without privileged proof\n");
	return 0;
}
