Minimal usage

`\n` are not escaped with $'' (bash only feat, cf https://github.com/yargs/yargs/issues/882)

# Barmaid

```
barmaid eldritch.cafe token "Hi, I'm only here to forward messages to the administration team. They will soon come back to you." $'Original status is direct, this is its content :\n\n' --user milia --ignore familier
```

# Familier

```
familier eldritch.cafe token "Hi, welcome here !"
```

# Serveuse

```
serveuse eldritch.cafe token
```