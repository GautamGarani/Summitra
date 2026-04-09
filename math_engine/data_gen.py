import numpy as np
# Initialize the first array

dataset = np.zeros((500, 100), dtype=np.float32)
dataset[0] = np.random.randn(100)

# Create a Random Walk: current = previous + small_noise
for i in range(1, 500):
    dataset[i] = dataset[i-1] + (np.random.randn(100) * 0.5)

np.savetxt('my_dataset.csv', dataset, delimiter=',')
